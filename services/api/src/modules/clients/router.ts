import { Hono } from 'hono'
import { client, createClientRequest, updateClientRequest } from '@ipc/contracts'
import type { AppEnv } from '../../context'
import { requireAuth } from '../../middleware/auth'
import { requireAction } from '../../middleware/permissions'
import { fail } from '../../middleware/errors'
import { withUser } from '../../lib/db'

export const clientsRouter = new Hono<AppEnv>()
  .use('*', requireAuth)

  .get('/', requireAction('clients', 'view'), async (c) => {
    const rows = await withUser(
      c.env,
      c.get('auth').userId,
      (sql) => sql`select * from clients order by created_at desc`,
    ).catch(() => null)
    if (!rows) fail(400, 'We could not load your clients.')
    return c.json(client.array().parse(rows))
  })

  .post('/', requireAction('clients', 'create'), async (c) => {
    const parsed = createClientRequest.safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success) fail(422, 'Please check the client details and try again.')
    const auth = c.get('auth')
    const row = await withUser(c.env, auth.userId, async (sql) => {
      const rows = await sql`
        insert into clients ${sql({ ...parsed.data, company_id: auth.companyId, created_by: auth.userId })}
        returning *`
      return rows[0]
    }).catch(() => null)
    if (!row) fail(400, 'We could not create this client.')
    return c.json(client.parse(row), 201)
  })

  .get('/:id', requireAction('clients', 'view'), async (c) => {
    const row = await withUser(c.env, c.get('auth').userId, async (sql) => {
      const rows = await sql`select * from clients where id = ${c.req.param('id')!}`
      return rows[0]
    }).catch(() => null)
    if (!row) fail(404, 'That client was not found.')
    return c.json(client.parse(row))
  })

  .patch('/:id', requireAction('clients', 'edit'), async (c) => {
    const parsed = updateClientRequest.safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success) fail(422, 'Please check the client details and try again.')
    const row = await withUser(c.env, c.get('auth').userId, async (sql) => {
      const rows = await sql`
        update clients set ${sql(parsed.data)} where id = ${c.req.param('id')!} returning *`
      return rows[0]
    }).catch(() => null)
    if (!row) fail(400, 'We could not update this client.')
    return c.json(client.parse(row))
  })

  .delete('/:id', requireAction('clients', 'delete'), async (c) => {
    const ok = await withUser(c.env, c.get('auth').userId, async (sql) => {
      await sql`delete from clients where id = ${c.req.param('id')!}`
      return true
    }).catch(() => false)
    if (!ok) fail(409, 'This client has linked projects and cannot be deleted.')
    return c.body(null, 204)
  })
