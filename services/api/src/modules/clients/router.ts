import { Hono } from 'hono'
import { client, createClientRequest, updateClientRequest } from '@ipc/contracts'
import type { AppEnv } from '../../context'
import { requireAuth } from '../../middleware/auth'
import { requireAction } from '../../middleware/permissions'
import { fail } from '../../middleware/errors'
import { uuidParam } from '../../lib/params'
import { withUser } from '../../lib/db'
import { attempt } from '../../lib/attempt'
import { audit } from '../../lib/audit'

export const clientsRouter = new Hono<AppEnv>()
  .use('*', requireAuth)

  .get('/', requireAction('clients', 'view'), async (c) => {
    const rows = await attempt(c, 'clients.list', () =>
      withUser(c.env, c.get('auth').userId, (sql) => sql`select * from clients order by created_at desc`),
    )
    if (!rows) fail(400, 'We could not load your clients.')
    return c.json(client.array().parse(rows))
  })

  .post('/', requireAction('clients', 'create'), async (c) => {
    const parsed = createClientRequest.safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success) fail(422, 'Please check the client details and try again.')
    const auth = c.get('auth')
    const row = await attempt(c, 'clients.create', () =>
      withUser(c.env, auth.userId, async (sql) => {
        const rows = await sql`
          insert into clients ${sql({ ...parsed.data, company_id: auth.companyId, created_by: auth.userId })}
          returning *`
        return rows[0] ?? null
      }),
    )
    if (!row) fail(400, 'We could not create this client.')
    const created = client.parse(row)
    await audit(c, { action: 'client.create', entityType: 'client', entityId: created.id, after: parsed.data })
    return c.json(created, 201)
  })

  .get('/:id', requireAction('clients', 'view'), async (c) => {
    const id = uuidParam(c)
    const row = await attempt(c, 'clients.get', () =>
      withUser(c.env, c.get('auth').userId, async (sql) => {
        const rows = await sql`select * from clients where id = ${id}`
        return rows[0] ?? null
      }),
    )
    if (!row) fail(404, 'That client was not found.')
    return c.json(client.parse(row))
  })

  .patch('/:id', requireAction('clients', 'edit'), async (c) => {
    const parsed = updateClientRequest.safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success) fail(422, 'Please check the client details and try again.')
    if (Object.keys(parsed.data).length === 0) fail(422, 'Nothing to change.')
    const id = uuidParam(c)
    const row = await attempt(c, 'clients.update', () =>
      withUser(c.env, c.get('auth').userId, async (sql) => {
        const rows = await sql`update clients set ${sql(parsed.data)} where id = ${id} returning *`
        return rows[0] ?? null
      }),
    )
    if (!row) fail(404, 'That client was not found.')
    await audit(c, { action: 'client.update', entityType: 'client', entityId: id, after: parsed.data })
    return c.json(client.parse(row))
  })

  .delete('/:id', requireAction('clients', 'delete'), async (c) => {
    const id = uuidParam(c)
    const rows = await attempt(
      c,
      'clients.delete',
      () =>
        withUser(c.env, c.get('auth').userId, (sql) => sql<{ id: string }[]>`
          delete from clients where id = ${id} returning id`),
      { onCode: (code) => (code === '23503' ? 'in_use' : undefined) },
    )
    if (rows === 'in_use') fail(409, 'This client has linked projects and cannot be deleted.')
    if (!rows) fail(400, 'We could not delete this client.')
    if (!rows.length) fail(404, 'That client was not found.')
    await audit(c, { action: 'client.delete', entityType: 'client', entityId: id })
    return c.body(null, 204)
  })
