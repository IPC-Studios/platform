import { Hono } from 'hono'
import { notification } from '@ipc/contracts'
import type { AppEnv } from '../../context'
import { requireAuth } from '../../middleware/auth'
import { fail } from '../../middleware/errors'
import { uuidParam } from '../../lib/params'
import { withUser } from '../../lib/db'
import { attempt } from '../../lib/attempt'
import { audit } from '../../lib/audit'

const list = notification.array()

export const notificationsRouter = new Hono<AppEnv>()
  .use('*', requireAuth)

  .get('/', async (c) => {
    const rows = await attempt(c, 'notifications.list', () =>
      withUser(
        c.env,
        c.get('auth').userId,
        (sql) => sql`
          select id, type, title, body, read_at, created_at
          from notifications order by created_at desc limit 50`,
      ),
    )
    if (!rows) fail(400, 'We could not load notifications.')
    return c.json(list.parse(rows))
  })

  .post('/:id/read', async (c) => {
    const id = uuidParam(c)
    const rows = await attempt(c, 'notifications.read', () =>
      withUser(
        c.env,
        c.get('auth').userId,
        (sql) => sql<{ id: string }[]>`
          update notifications set read_at = coalesce(read_at, now()) where id = ${id} returning id`,
      ),
    )
    if (!rows) fail(400, 'We could not update the notification.')
    if (!rows.length) fail(404, 'That notification was not found.')
    await audit(c, { action: 'notification.read', entityType: 'notification', entityId: id })
    return c.body(null, 204)
  })

  .post('/read-all', async (c) => {
    const ok = await attempt(c, 'notifications.read_all', () =>
      withUser(c.env, c.get('auth').userId, async (sql) => {
        await sql`update notifications set read_at = now() where read_at is null`
        return true
      }),
    )
    if (!ok) fail(400, 'We could not update your notifications.')
    await audit(c, { action: 'notification.read_all', entityType: 'notification' })
    return c.body(null, 204)
  })
