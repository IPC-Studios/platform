import { Hono } from 'hono'
import { addMemberRequest, addMemberResponse, directoryMember, teamMember } from '@ipc/contracts'
import type { AppEnv } from '../../context'
import { requireAuth } from '../../middleware/auth'
import { requireOwner } from '../../middleware/permissions'
import { fail } from '../../middleware/errors'
import { requestClient, serviceClient } from '../../lib/supabase'

/** Team directory. /members backs pickers; /directory is the full staff list. */
export const teamRouter = new Hono<AppEnv>()
  .use('*', requireAuth)

  .get('/members', async (c) => {
    const { data, error } = await requestClient(c)
      .from('users')
      .select('user_id,name,role')
      .is('deleted_at', null)
      .order('name')
    if (error) fail(400, 'We could not load the team.')
    return c.json(teamMember.array().parse(data ?? []))
  })

  .get('/directory', async (c) => {
    const { data, error } = await requestClient(c)
      .from('users')
      .select('user_id,name,email,role,phone,status')
      .is('deleted_at', null)
      .order('name')
    if (error) fail(400, 'We could not load the team.')
    return c.json(directoryMember.array().parse(data ?? []))
  })

  // Owner adds a staff member: creates their auth user + tenant row via the
  // service role, and returns a one-time temp password to share.
  .post('/members', requireOwner(), async (c) => {
    const parsed = addMemberRequest.safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success) fail(422, 'Please check the member details.')
    const { name, email, role, phone } = parsed.data

    const svc = serviceClient(c.env)
    const tempPassword = crypto.randomUUID().slice(0, 12) + 'A1!'

    const { data: created, error: createErr } = await svc.auth.admin.createUser({
      email,
      password: tempPassword,
      email_confirm: true,
    })
    if (createErr || !created.user) {
      if (createErr?.message?.toLowerCase().includes('already')) {
        fail(409, 'Someone with that email already has an account.')
      }
      fail(400, 'We could not create this member.')
    }

    const userId = created.user.id
    const { error: rowErr } = await svc.from('users').insert({
      user_id: userId,
      company_id: c.get('auth').companyId,
      role,
      name,
      email,
      phone: phone ?? null,
      status: 'active',
      employee_type: role === 'employee' ? 1 : 2,
    })
    if (rowErr) {
      // Roll back the orphaned auth user so a retry can reuse the email.
      await svc.auth.admin.deleteUser(userId).catch(() => {})
      fail(400, 'We could not add this member.')
    }

    return c.json(addMemberResponse.parse({ user_id: userId, temp_password: tempPassword }), 201)
  })
