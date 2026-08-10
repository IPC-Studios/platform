import { Hono } from 'hono'
import { setUserAccessRequest, userAccess } from '@ipc/contracts'
import type { AppEnv } from '../../context'
import { requireAuth } from '../../middleware/auth'
import { requireOwner } from '../../middleware/permissions'
import { fail } from '../../middleware/errors'
import { withUser } from '../../lib/db'

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
    const row = await withUser(c.env, c.get('auth').userId, async (sql) => {
      const rows = await sql`select * from get_user_access(p_target_user_id => ${c.req.param('userId')})`
      return rows[0] as { profile_key: string | null; overrides: unknown } | undefined
    }).catch(() => null)
    if (!row) fail(404, 'That team member was not found.')
    return c.json(userAccess.parse({ profile_key: row!.profile_key, overrides: row!.overrides ?? [] }))
  })

  .put('/:userId', async (c) => {
    const parsed = setUserAccessRequest.safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success) fail(422, 'Please check the access settings and try again.')

    const ok = await withUser(c.env, c.get('auth').userId, async (sql) => {
      await sql`
        select set_user_access(
          p_target_user_id => ${c.req.param('userId')},
          p_profile_key => ${parsed.data.profile_key},
          p_overrides => ${sql.json(parsed.data.overrides)}
        )`
      return true
    }).catch(() => false)
    if (!ok) fail(403, 'We could not update access for that team member.')
    return c.body(null, 204)
  })
