import { Hono } from 'hono'
import { teamMember } from '@ipc/contracts'
import type { AppEnv } from '../../context'
import { requireAuth } from '../../middleware/auth'
import { fail } from '../../middleware/errors'
import { requestClient } from '../../lib/supabase'

/** Team directory basics. /members backs assignee + booking pickers everywhere. */
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
