import { Hono, type Context } from 'hono'
import {
  addMemberRequest,
  addMemberResponse,
  assignRolesRequest,
  createInvitationRequest,
  directoryMember,
  employeeRole,
  invitation,
  invitationLink,
  teamMember,
  updateMemberRequest,
  upsertEmployeeRoleRequest,
} from '@ipc/contracts'
import type { AppEnv } from '../../context'
import { requireAuth } from '../../middleware/auth'
import { requireModule, requireOwner } from '../../middleware/permissions'
import { rateLimit } from '../../middleware/security'
import { fail } from '../../middleware/errors'
import { uuidParam } from '../../lib/params'
import { withUser, withService } from '../../lib/db'
import { attempt } from '../../lib/attempt'
import { audit } from '../../lib/audit'
import { hashPassword, newRawToken, sha256Hex } from '../../lib/auth-token'
import { sendInvitationEmail, sendPasswordResetEmail } from '../../lib/email'

const INVITE_DAYS = 7

const inviteLink = (env: AppEnv['Bindings'], raw: string) =>
  `${env.APP_URL}/accept-invite?token=${raw}`

const duplicateCode = (code: string) => (code === '23505' ? ('duplicate' as const) : undefined)

/** The studio's display name for the invitation email; never fails the send. */
async function companyName(c: Context<AppEnv>): Promise<string> {
  const rows = await attempt(c, 'team.company_name', () =>
    withUser(
      c.env,
      c.get('auth').userId,
      (sql) => sql<{ name: string }[]>`select name from companies where id = ${c.get('auth').companyId}`,
    ),
  )
  return rows?.[0]?.name ?? 'Your studio'
}

/** Team directory. /members backs pickers; /directory is the full staff list. */
export const teamRouter = new Hono<AppEnv>()
  .use('*', requireAuth)

  .get('/members', async (c) => {
    const rows = await attempt(c, 'team.members', () =>
      withUser(
        c.env,
        c.get('auth').userId,
        (sql) => sql`select user_id, name, role from users where deleted_at is null order by name`,
      ),
    )
    if (!rows) fail(400, 'We could not load the team.')
    return c.json(teamMember.array().parse(rows))
  })

  // The directory carries compensation, so the row is assembled once and then
  // trimmed per caller: only team_salaries sees `salary`. Filtering client-side
  // would ship every studio's payroll to every manager's browser.
  .get('/directory', requireModule('team_directory'), async (c) => {
    const rows = await attempt(c, 'team.directory', () =>
      withUser(
        c.env,
        c.get('auth').userId,
        (sql) => sql`
          select
            u.user_id, u.name, u.email, u.role, u.phone, u.alternate_phone, u.status,
            u.engagement_type, u.login_enabled, u.salary, u.address, u.created_at,
            coalesce(
              array_agg(er.type_name order by er.type_name) filter (where er.id is not null),
              '{}'::text[]
            ) as role_names,
            coalesce(
              array_agg(er.id order by er.type_name) filter (where er.id is not null),
              '{}'::uuid[]
            ) as role_ids
          from users u
          left join employee_role_assignments era on era.user_id = u.user_id
          left join employee_roles er on er.id = era.role_id
          where u.deleted_at is null
          group by u.user_id
          order by u.name`,
      ),
    )
    if (!rows) fail(400, 'We could not load the team.')

    const canSeeSalary = c.get('auth').access.hasModule('team_salaries')
    const list = directoryMember.array().parse(rows)
    return c.json(canSeeSalary ? list : list.map((m) => ({ ...m, salary: null })))
  })

  // ── Job roles (Photographer, Editor…) ───────────────────────
  .get('/roles', requireModule('team_roles'), async (c) => {
    const rows = await attempt(c, 'team.roles', () =>
      withUser(
        c.env,
        c.get('auth').userId,
        (sql) => sql`
          select r.id, r.type_name, r.role_code, count(a.user_id)::int as member_count
          from employee_roles r
          left join employee_role_assignments a on a.role_id = r.id
          group by r.id
          order by r.type_name`,
      ),
    )
    if (!rows) fail(400, 'We could not load the roles.')
    return c.json(employeeRole.array().parse(rows))
  })

  .post('/roles', requireOwner(), async (c) => {
    const parsed = upsertEmployeeRoleRequest.safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success) fail(422, 'Please check the role name and code.')
    const { type_name, role_code } = parsed.data
    const companyId = c.get('auth').companyId

    const rows = await attempt(
      c,
      'team.role_create',
      () =>
        withUser(
          c.env,
          c.get('auth').userId,
          (sql) => sql<{ id: string }[]>`
            insert into employee_roles (company_id, type_name, role_code)
            values (${companyId}, ${type_name}, ${role_code})
            returning id`,
        ),
      { onCode: duplicateCode },
    )
    if (rows === 'duplicate') fail(409, 'A role with that code already exists.')
    if (!rows || !rows[0]) fail(400, 'We could not create this role.')
    await audit(c, { action: 'role.create', entityType: 'employee_role', entityId: rows[0].id, after: parsed.data })
    return c.json(employeeRole.parse({ ...parsed.data, id: rows[0].id, member_count: 0 }), 201)
  })

  .patch('/roles/:id', requireOwner(), async (c) => {
    const id = uuidParam(c)
    const parsed = upsertEmployeeRoleRequest.safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success) fail(422, 'Please check the role name and code.')
    const { type_name, role_code } = parsed.data

    const rows = await attempt(
      c,
      'team.role_update',
      () =>
        withUser(
          c.env,
          c.get('auth').userId,
          (sql) => sql<{ id: string }[]>`
            update employee_roles set type_name = ${type_name}, role_code = ${role_code}
            where id = ${id} returning id`,
        ),
      { onCode: duplicateCode },
    )
    if (rows === 'duplicate') fail(409, 'A role with that code already exists.')
    if (!rows) fail(400, 'We could not update this role.')
    if (!rows.length) fail(404, 'We could not find that role.')
    await audit(c, { action: 'role.update', entityType: 'employee_role', entityId: id, after: parsed.data })
    return c.json({ ok: true })
  })

  .delete('/roles/:id', requireOwner(), async (c) => {
    const id = uuidParam(c)
    const rows = await attempt(c, 'team.role_delete', () =>
      withUser(
        c.env,
        c.get('auth').userId,
        (sql) => sql<{ id: string }[]>`delete from employee_roles where id = ${id} returning id`,
      ),
    )
    if (!rows) fail(400, 'We could not delete this role.')
    if (!rows.length) fail(404, 'We could not find that role.')
    await audit(c, { action: 'role.delete', entityType: 'employee_role', entityId: id })
    return c.json({ ok: true })
  })

  // Replace a member's job roles wholesale — the dialog sends the full set, so
  // a partial write would silently drop the ones it didn't mention.
  .patch('/members/:id/roles', requireOwner(), async (c) => {
    const id = uuidParam(c)
    const parsed = assignRolesRequest.safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success) fail(422, 'Please check the selected roles.')
    const companyId = c.get('auth').companyId

    const done = await attempt(c, 'team.assign_roles', () =>
      withUser(c.env, c.get('auth').userId, async (sql) => {
        const [member] = await sql<{ user_id: string }[]>`
          select user_id from users where user_id = ${id} and deleted_at is null`
        if (!member) return 'missing' as const
        await sql`delete from employee_role_assignments where user_id = ${id}`
        for (const roleId of parsed.data.role_ids) {
          await sql`
            insert into employee_role_assignments (user_id, role_id, company_id)
            values (${id}, ${roleId}, ${companyId})
            on conflict do nothing`
        }
        return 'ok' as const
      }),
    )
    if (done === 'missing') fail(404, 'We could not find that team member.')
    if (!done) fail(400, 'We could not update their roles.')
    await audit(c, { action: 'member.roles_set', entityType: 'user', entityId: id, after: parsed.data })
    return c.json({ ok: true })
  })

  // ── Members ─────────────────────────────────────────────────
  // Owner adds a member. Two shapes come through here: one with a login (an
  // auth identity + password the owner chose) and one without (a directory-only
  // person — bookable and assignable, with no credential to leak). Both need an
  // identity row, because `users.user_id` is the auth id; the offline one simply
  // has no password, which is what `/auth/login` already refuses on.
  .post('/members', requireOwner(), async (c) => {
    const parsed = addMemberRequest.safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success) fail(422, 'Please check the member details.')
    const {
      name,
      email,
      role,
      phone,
      alternate_phone,
      password,
      create_login,
      engagement_type,
      salary,
      address,
      role_ids,
    } = parsed.data

    const pwHash = create_login && password ? await hashPassword(password) : null
    const companyId = c.get('auth').companyId

    // One transaction: create the auth user and its tenant row together, so a
    // failed row insert rolls back the auth user (no orphan to clean up).
    const userId = await attempt(
      c,
      'team.member_add',
      () =>
        withService(c.env, async (sql) => {
          const created = await sql<{ id: string }[]>`
            insert into auth.users (email, encrypted_password, email_verified, email_verified_at)
            values (
              ${email ?? null}, ${pwHash},
              ${create_login}, ${create_login ? new Date().toISOString() : null}
            )
            returning id`
          const id = created[0]!.id
          await sql`
            insert into users ${sql({
              user_id: id,
              company_id: companyId,
              role,
              name,
              email: email ?? null,
              phone,
              alternate_phone: alternate_phone ?? null,
              status: 'active',
              employee_type: role === 'employee' ? 1 : 2,
              engagement_type,
              salary: salary ?? null,
              address: address ?? null,
              login_enabled: create_login,
            })}`
          for (const roleId of role_ids) {
            await sql`
              insert into employee_role_assignments (user_id, role_id, company_id)
              select ${id}, ${roleId}, ${companyId}
              where exists (
                select 1 from employee_roles where id = ${roleId} and company_id = ${companyId}
              )`
          }
          return id
        }),
      { onCode: duplicateCode },
    )
    if (userId === 'duplicate') fail(409, 'Someone with that email already has an account.')
    if (!userId) fail(400, 'We could not add this member.')

    await audit(c, {
      action: 'member.add',
      entityType: 'user',
      entityId: userId,
      after: { name, email, role, create_login, engagement_type, role_ids },
    })
    // The owner picked the password, so there is nothing to hand back.
    return c.json(addMemberResponse.parse({ user_id: userId, temp_password: null }), 201)
  })

  .patch('/members/:id', requireOwner(), async (c) => {
    const id = uuidParam(c)
    const parsed = updateMemberRequest.safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success) fail(422, 'Please check the details.')
    const patch = parsed.data
    if (Object.keys(patch).length === 0) return c.json({ ok: true })

    const rows = await attempt(c, 'team.member_update', () =>
      withUser(
        c.env,
        c.get('auth').userId,
        (sql) => sql<{ user_id: string }[]>`
          update users set ${sql({
            ...patch,
            ...(patch.role ? { employee_type: patch.role === 'employee' ? 1 : 2 } : {}),
          })}
          where user_id = ${id} and deleted_at is null
          returning user_id`,
      ),
    )
    if (!rows) fail(400, 'We could not update this member.')
    if (!rows.length) fail(404, 'We could not find that team member.')
    // Salary is sensitive: record that it changed, not what it changed to.
    const { salary, ...rest } = patch
    await audit(c, {
      action: 'member.update',
      entityType: 'user',
      entityId: id,
      after: { ...rest, ...(salary !== undefined ? { salary_changed: true } : {}) },
    })
    return c.json({ ok: true })
  })

  // Soft delete: the person stays on past shoots, tasks and payouts. Their
  // access dies at the next `authenticate()`, which reads deleted_at.
  .delete('/members/:id', requireOwner(), async (c) => {
    const id = uuidParam(c)
    if (id === c.get('auth').userId) fail(409, 'You cannot remove your own account.')

    const rows = await attempt(c, 'team.member_remove', () =>
      withUser(
        c.env,
        c.get('auth').userId,
        (sql) => sql<{ user_id: string }[]>`
          update users
             set deleted_at = now(), deleted_by = ${c.get('auth').userId}, status = 'inactive'
           where user_id = ${id} and deleted_at is null
           returning user_id`,
      ),
    )
    if (!rows) fail(400, 'We could not remove this member.')
    if (!rows.length) fail(404, 'We could not find that team member.')
    // Their sessions end now, not at the next access-token mint (0034).
    await attempt(c, 'team.member_remove_sessions', () =>
      withService(c.env, (sql) => sql`select revoke_all_sessions(${id})`),
    )
    await audit(c, { action: 'member.remove', entityType: 'user', entityId: id })
    return c.json({ ok: true })
  })

  // Owner emails a staff member a reset link — the everyday "I'm locked out"
  // fix, without the owner ever handling their password.
  // Issuing supersedes the member's own outstanding link, and it sends mail, so
  // it needs a ceiling of its own — /team/* is outside the global /auth/* limit.
  .post('/members/:id/reset-password', requireOwner(), rateLimit({ windowMs: 60_000, limit: 5 }), async (c) => {
    const targetId = uuidParam(c)

    // Read the target through the CALLER's RLS scope, so an owner can only ever
    // trigger this for someone in their own studio. A thrown query is a real
    // failure, not a miss — collapsing it into 404 would report a studio-wide
    // outage as "member not found".
    const rows = await attempt(c, 'team.reset_lookup', () =>
      withUser(
        c.env,
        c.get('auth').userId,
        (sql) => sql<{ email: string | null }[]>`
          select email from users where user_id = ${targetId} and deleted_at is null`,
      ),
    )
    if (!rows) fail(400, 'We could not look up that team member. Please try again.')
    const member = rows[0]
    if (!member) fail(404, 'We could not find that team member.')
    if (!member.email) fail(409, 'This member has no email address to send a link to.')

    const raw = await attempt(c, 'team.reset_issue', () =>
      withService(c.env, async (sql) => {
        const [t] = await sql<{ token: string }[]>`select issue_password_reset(${targetId}) as token`
        return t?.token ?? null
      }),
    )
    if (!raw) fail(400, 'We could not start a password reset for this member.')

    await sendPasswordResetEmail(c.env, member.email, `${c.env.APP_URL}/reset-password?token=${raw}`)
    await audit(c, { action: 'member.reset_password_sent', entityType: 'user', entityId: targetId })
    return c.json({ ok: true })
  })

  // ── Invitations ─────────────────────────────────────────────
  // The other way in: instead of the owner choosing a password and passing it
  // along, the invitee sets their own by following a 7-day link. Only the hash
  // is stored, so a database read never yields a usable invitation.
  .get('/invitations', requireOwner(), async (c) => {
    const rows = await attempt(c, 'team.invitations', () =>
      withUser(
        c.env,
        c.get('auth').userId,
        (sql) => sql`
          select id, email, pending_name as name, role, expires_at, created_at,
                 last_sent_at, send_count, (expires_at <= now()) as expired
          from user_invitations
          where accepted_at is null and revoked_at is null
          order by created_at desc`,
      ),
    )
    if (!rows) fail(400, 'We could not load the invitations.')
    return c.json(invitation.array().parse(rows))
  })

  .post('/invitations', requireOwner(), rateLimit({ windowMs: 60_000, limit: 10 }), async (c) => {
    const parsed = createInvitationRequest.safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success) fail(422, 'Please check the invitation details.')
    const v = parsed.data
    const companyId = c.get('auth').companyId
    const raw = newRawToken()
    const hash = await sha256Hex(raw)

    const result = await attempt(
      c,
      'team.invite',
      () =>
        withUser(c.env, c.get('auth').userId, async (sql) => {
          const [taken] = await sql<{ user_id: string }[]>`
            select user_id from users where lower(email) = ${v.email} and deleted_at is null`
          if (taken) return 'member' as const
          const [row] = await sql<{ id: string; expires_at: string }[]>`
            insert into user_invitations ${sql({
              company_id: companyId,
              email: v.email,
              token_hash: hash,
              role: v.role,
              pending_name: v.name,
              pending_phone: v.phone ?? null,
              pending_alternate_phone: v.alternate_phone ?? null,
              pending_engagement_type: v.engagement_type ?? null,
              pending_salary: v.salary ?? null,
              pending_address: v.address ?? null,
              invited_by: c.get('auth').userId,
              expires_at: new Date(Date.now() + INVITE_DAYS * 86_400_000).toISOString(),
            })}
            returning id, expires_at`
          // pending_role_ids is a uuid[]; postgres.js needs it typed explicitly.
          await sql`
            update user_invitations set pending_role_ids = ${sql.array(v.role_ids)}::uuid[]
            where id = ${row!.id}`
          return row!
        }),
      { onCode: duplicateCode },
    )

    if (result === 'member') fail(409, 'Someone with that email is already on your team.')
    if (result === 'duplicate') fail(409, 'That address already has a pending invitation.')
    if (!result) fail(400, 'We could not create this invitation.')

    await sendInvitationEmail(c.env, v.email, inviteLink(c.env, raw), await companyName(c))
    await audit(c, { action: 'invitation.create', entityType: 'user_invitation', entityId: result.id, after: { email: v.email, role: v.role } })

    return c.json(
      invitationLink.parse({ id: result.id, invite_link: inviteLink(c.env, raw), expires_at: result.expires_at }),
      201,
    )
  })

  // Resending rotates the token, so the previous link dies here rather than
  // living on beside its replacement.
  .post('/invitations/:id/resend', requireOwner(), rateLimit({ windowMs: 60_000, limit: 10 }), async (c) => {
    const id = uuidParam(c)
    const raw = newRawToken()
    const hash = await sha256Hex(raw)

    const rows = await attempt(c, 'team.invite_resend', () =>
      withUser(
        c.env,
        c.get('auth').userId,
        (sql) => sql<{ email: string; expires_at: string }[]>`
          update user_invitations
             set token_hash = ${hash},
                 expires_at = ${new Date(Date.now() + INVITE_DAYS * 86_400_000).toISOString()},
                 send_count = send_count + 1,
                 last_sent_at = now()
           where id = ${id} and accepted_at is null and revoked_at is null
           returning email, expires_at`,
      ),
    )
    if (!rows) fail(400, 'We could not resend this invitation.')
    if (!rows.length) fail(404, 'We could not find that invitation.')

    await sendInvitationEmail(c.env, rows[0]!.email, inviteLink(c.env, raw), await companyName(c))
    await audit(c, { action: 'invitation.resend', entityType: 'user_invitation', entityId: id })

    return c.json(
      invitationLink.parse({ id, invite_link: inviteLink(c.env, raw), expires_at: rows[0]!.expires_at }),
    )
  })

  .delete('/invitations/:id', requireOwner(), async (c) => {
    const id = uuidParam(c)
    const rows = await attempt(c, 'team.invite_revoke', () =>
      withUser(
        c.env,
        c.get('auth').userId,
        (sql) => sql<{ id: string }[]>`
          update user_invitations set revoked_at = now()
          where id = ${id} and accepted_at is null and revoked_at is null
          returning id`,
      ),
    )
    if (!rows) fail(400, 'We could not revoke this invitation.')
    if (!rows.length) fail(404, 'We could not find that invitation.')
    await audit(c, { action: 'invitation.revoke', entityType: 'user_invitation', entityId: id })
    return c.json({ ok: true })
  })
