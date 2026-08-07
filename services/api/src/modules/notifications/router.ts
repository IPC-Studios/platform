import { Hono } from 'hono'
import { notification } from '@ipc/contracts'
import type { AppEnv } from '../../context'
import { requireAuth } from '../../middleware/auth'
import { fail } from '../../middleware/errors'
import { requestClient } from '../../lib/supabase'

const list = notification.array()

export const notificationsRouter = new Hono<AppEnv>()
  .use('*', requireAuth)

  .get('/', async (c) => {
    const { data, error } = await requestClient(c)
      .from('notifications')
      .select('id,type,title,body,read_at,created_at')
      .order('created_at', { ascending: false })
      .limit(50)
    if (error) fail(400, 'We could not load notifications.')
    return c.json(list.parse(data ?? []))
  })

  .post('/:id/read', async (c) => {
    const { error } = await requestClient(c)
      .from('notifications')
      .update({ read_at: new Date().toISOString() })
      .eq('id', c.req.param('id'))
    if (error) fail(400, 'We could not update the notification.')
    return c.body(null, 204)
  })
