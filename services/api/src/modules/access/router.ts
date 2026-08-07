import { Hono } from 'hono'
import { setUserAccessRequest, userAccess } from '@ipc/contracts'
import type { AppEnv } from '../../context'
import { requireAuth } from '../../middleware/auth'
import { requireOwner } from '../../middleware/permissions'
import { fail } from '../../middleware/errors'
import { userClient } from '../../lib/supabase'

/**
 * Access management. Owner-only (the RPCs enforce it again server-side). The
 * SET path is atomic + audited inside set_user_access; the GET reads raw inputs
 * (profile + overrides), not the resolved set — the client resolves via the
 * shared registry.
 */
export const accessRouter = new Hono<AppEnv>()
  .use('*', requireAuth)
  .use('*', requireOwner())

  .get('/:userId', async (c) => {
    const token = (c.req.header('Authorization') ?? '').slice(7)
    const supabase = userClient(c.env, token)
    const { data, error } = await supabase
      .rpc('get_user_access', { p_target_user_id: c.req.param('userId') })
      .single()
    if (error || !data) fail(404, 'That team member was not found.')
    const row = data as { profile_key: string | null; overrides: unknown }
    return c.json(userAccess.parse({ profile_key: row.profile_key, overrides: row.overrides ?? [] }))
  })

  .put('/:userId', async (c) => {
    const parsed = setUserAccessRequest.safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success) fail(422, 'Please check the access settings and try again.')

    const token = (c.req.header('Authorization') ?? '').slice(7)
    const supabase = userClient(c.env, token)
    const { error } = await supabase.rpc('set_user_access', {
      p_target_user_id: c.req.param('userId'),
      p_profile_key: parsed.data.profile_key,
      p_overrides: parsed.data.overrides,
    })
    if (error) fail(403, 'We could not update access for that team member.')
    return c.body(null, 204)
  })
