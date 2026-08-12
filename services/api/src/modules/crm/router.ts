import { Hono } from 'hono'
import { crmLead, updateLeadRequest } from '@ipc/contracts'
import type { AppEnv } from '../../context'
import { requireAuth } from '../../middleware/auth'
import { requireModule } from '../../middleware/permissions'
import { fail } from '../../middleware/errors'
import { withUser } from '../../lib/db'

const list = crmLead.array()

export const crmRouter = new Hono<AppEnv>()
  .use('*', requireAuth)
  .use('*', requireModule('crm'))

  .get('/leads', async (c) => {
    const rows = await withUser(
      c.env,
      c.get('auth').userId,
      (sql) => sql`
        select l.id, l.name, l.phone, l.email, l.source, l.status, l.assigned_to, l.created_at,
               u.name as assignee_name
        from crm_leads l
        left join users u on u.user_id = l.assigned_to
        order by l.created_at desc`,
    ).catch(() => null)
    if (!rows) fail(400, 'We could not load leads.')
    return c.json(list.parse(rows))
  })

  .patch('/leads/:id', async (c) => {
    const parsed = updateLeadRequest.safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success) fail(422, 'Invalid update.')
    const ok = await withUser(c.env, c.get('auth').userId, async (sql) => {
      await sql`update crm_leads set ${sql(parsed.data)} where id = ${c.req.param('id')!}`
      return true
    }).catch(() => false)
    if (!ok) fail(400, 'We could not update the lead.')
    return c.body(null, 204)
  })
