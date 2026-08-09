import { Hono } from 'hono'
import { platformStudioList, platformUsage, platformPlanAction } from '@ipc/contracts'
import type { AppEnv } from '../../context'
import { requireAuth } from '../../middleware/auth'
import { requirePlatformAdmin } from '../../middleware/permissions'
import { fail } from '../../middleware/errors'
import { requestClient } from '../../lib/supabase'

/**
 * The vendor's cross-tenant console. Gated twice: requirePlatformAdmin() here,
 * and again inside each security-definer RPC (defence in depth — the RPC is the
 * boundary that actually crosses tenant RLS).
 */
export const platformRouter = new Hono<AppEnv>()
  .use('*', requireAuth, requirePlatformAdmin())

  .get('/studios', async (c) => {
    const { data, error } = await requestClient(c).rpc('platform_list_studios')
    if (error) fail(400, 'We could not load studios.')
    return c.json(platformStudioList.parse(data ?? []))
  })

  .get('/usage', async (c) => {
    const { data, error } = await requestClient(c).rpc('platform_usage_summary').single()
    if (error || !data) fail(400, 'We could not load usage.')
    return c.json(platformUsage.parse(data))
  })

  // Extend / expire / grant-trial on one tenant's plan. Each RPC re-checks the
  // allowlist and logs a billing_event.
  .post('/studios/:id/plan', async (c) => {
    const parsed = platformPlanAction.safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success) fail(422, 'Please check the action.')
    const id = c.req.param('id')
    const db = requestClient(c)
    const { action, months } = parsed.data
    const { error } =
      action === 'extend'
        ? await db.rpc('platform_extend_plan', { p_company_id: id, p_months: months })
        : action === 'expire'
          ? await db.rpc('platform_expire_plan', { p_company_id: id })
          : await db.rpc('platform_grant_trial', { p_company_id: id })
    if (error) fail(400, 'We could not update the plan.')
    return c.json({ ok: true })
  })
