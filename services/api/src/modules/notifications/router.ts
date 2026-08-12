import { Hono } from 'hono'
import { notification } from '@ipc/contracts'
import type { AppEnv } from '../../context'
import { requireAuth } from '../../middleware/auth'
import { fail } from '../../middleware/errors'
import { withUser } from '../../lib/db'

const list = notification.array()

export const notificationsRouter = new Hono<AppEnv>()
  .use('*', requireAuth)

  .get('/', async (c) => {
    const rows = await withUser(
      c.env,
      c.get('auth').userId,
      (sql) => sql`
        select id, type, title, body, read_at, created_at
        from notifications order by created_at desc limit 50`,
    ).catch(() => null)
    if (!rows) fail(400, 'We could not load notifications.')
    return c.json(list.parse(rows))
  })

  .post('/:id/read', async (c) => {
    const ok = await withUser(c.env, c.get('auth').userId, async (sql) => {
      await sql`update notifications set read_at = ${new Date().toISOString()} where id = ${c.req.param('id')}`
      return true
    }).catch(() => false)
    if (!ok) fail(400, 'We could not update the notification.')
    return c.body(null, 204)
  })
