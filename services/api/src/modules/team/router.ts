import { Hono } from 'hono'
import { addMemberRequest, addMemberResponse, directoryMember, teamMember } from '@ipc/contracts'
import type { AppEnv } from '../../context'
import { requireAuth } from '../../middleware/auth'
import { requireOwner } from '../../middleware/permissions'
import { fail } from '../../middleware/errors'
import { withUser, withService } from '../../lib/db'
import { hashPassword } from '../../lib/auth-token'
import { sendPasswordResetEmail } from '../../lib/email'

/** Team directory. /members backs pickers; /directory is the full staff list. */
export const teamRouter = new Hono<AppEnv>()
  .use('*', requireAuth)

  .get('/members', async (c) => {
    const rows = await withUser(
      c.env,
      c.get('auth').userId,
      (sql) => sql`
        select user_id, name, role from users where deleted_at is null order by name`,
    ).catch(() => null)
    if (!rows) fail(400, 'We could not load the team.')
    return c.json(teamMember.array().parse(rows))
  })

  .get('/directory', async (c) => {
    const rows = await withUser(
      c.env,
      c.get('auth').userId,
      (sql) => sql`
        select user_id, name, email, role, phone, status
        from users where deleted_at is null order by name`,
    ).catch(() => null)
    if (!rows) fail(400, 'We could not load the team.')
    return c.json(directoryMember.array().parse(rows))
  })

  // Owner adds a staff member: creates their auth user + tenant row via the
  // service role, and returns a one-time temp password to share.
  .post('/members', requireOwner(), async (c) => {
    const parsed = addMemberRequest.safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success) fail(422, 'Please check the member details.')
    const { name, email, role, phone } = parsed.data

    const tempPassword = crypto.randomUUID().slice(0, 12) + 'A1!'
    const pwHash = await hashPassword(tempPassword)
    const companyId = c.get('auth').companyId

    // One transaction: create the auth user and its tenant row together, so a
    // failed row insert rolls back the auth user (no orphan to clean up).
    let userId: string
    try {
      userId = await withService(c.env, async (sql) => {
        let id: string
        try {
          const created = await sql<{ id: string }[]>`
            insert into auth.users (email, encrypted_password)
            values (${email}, ${pwHash})
            returning id`
          id = created[0]!.id
        } catch (e) {
          throw { stage: 'create', e }
        }
        try {
          await sql`
            insert into users ${sql({
              user_id: id,
              company_id: companyId,
              role,
              name,
              email,
              phone: phone ?? null,
              status: 'active',
              employee_type: role === 'employee' ? 1 : 2,
            })}`
        } catch (e) {
          throw { stage: 'row', e }
        }
        return id
      })
    } catch (err) {
      const stage = (err as { stage?: string })?.stage
      if (stage === 'create') {
        const code = (err as { e?: { code?: string } })?.e?.code
        if (code === '23505') {
          fail(409, 'Someone with that email already has an account.')
        }
        fail(400, 'We could not create this member.')
      }
      fail(400, 'We could not add this member.')
    }

    return c.json(addMemberResponse.parse({ user_id: userId!, temp_password: tempPassword }), 201)
  })

  // Owner emails a staff member a reset link — the everyday "I'm locked out"
  // fix, without the owner ever handling their password.
  .post('/members/:id/reset-password', requireOwner(), async (c) => {
    const targetId = c.req.param('id')!

    // Read the target through the CALLER's RLS scope, so an owner can only ever
    // trigger this for someone in their own studio.
    const [member] = await withUser(
      c.env,
      c.get('auth').userId,
      (sql) => sql<{ email: string }[]>`
        select email from users where user_id = ${targetId} and deleted_at is null`,
    ).catch(() => [])
    if (!member) fail(404, 'We could not find that team member.')

    const raw = await withService(c.env, async (sql) => {
      const [t] = await sql<{ token: string }[]>`select issue_password_reset(${targetId}) as token`
      return t!.token
    }).catch(() => null)
    if (!raw) fail(400, 'We could not start a password reset for this member.')

    await sendPasswordResetEmail(c.env, member.email, `${c.env.APP_URL}/reset-password?token=${raw}`)
    return c.json({ ok: true })
  })
