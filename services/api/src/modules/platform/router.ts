import { Hono } from 'hono'
import { platformStudioList, platformUsage, platformPlanAction } from '@ipc/contracts'
import type { AppEnv } from '../../context'
import { requireAuth } from '../../middleware/auth'
import { requirePlatformAdmin } from '../../middleware/permissions'
import { fail } from '../../middleware/errors'
import { uuidParam } from '../../lib/params'
import { withUser } from '../../lib/db'
import { attempt } from '../../lib/attempt'
import { audit } from '../../lib/audit'

/**
 * The vendor's cross-tenant console. Gated twice: requirePlatformAdmin() here,
 * and again inside each security-definer RPC (defence in depth — the RPC is the
 * boundary that actually crosses tenant RLS).
 */
export const platformRouter = new Hono<AppEnv>()
  .use('*', requireAuth, requirePlatformAdmin())

  .get('/studios', async (c) => {
    const rows = await attempt(c, 'platform.studios', () =>
      withUser(c.env, c.get('auth').userId, (sql) => sql`select * from platform_list_studios()`),
    )
    if (!rows) fail(400, 'We could not load studios.')
    return c.json(platformStudioList.parse(rows))
  })

  .get('/usage', async (c) => {
    const row = await attempt(c, 'platform.usage', () =>
      withUser(c.env, c.get('auth').userId, async (sql) => {
        const rows = await sql`select * from platform_usage_summary()`
        return rows[0] ?? null
      }),
    )
    if (!row) fail(400, 'We could not load usage.')
    return c.json(platformUsage.parse(row))
  })

  // Extend / expire / grant-trial on one tenant's plan. Each RPC re-checks the
  // allowlist and logs a billing_event; the audit row here is the vendor's own.
  .post('/studios/:id/plan', async (c) => {
    const parsed = platformPlanAction.safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success) fail(422, 'Please check the action.')
    const id = uuidParam(c)
    const { action, months } = parsed.data
    const ok = await attempt(c, 'platform.plan', () =>
      withUser(c.env, c.get('auth').userId, async (sql) => {
        if (action === 'extend') {
          await sql`select platform_extend_plan(p_company_id => ${id}, p_months => ${months!})`
        } else if (action === 'expire') {
          await sql`select platform_expire_plan(p_company_id => ${id})`
        } else {
          await sql`select platform_grant_trial(p_company_id => ${id})`
        }
        return true
      }),
    )
    if (!ok) fail(400, 'We could not update the plan.')
    await audit(c, { action: `platform.plan_${action}`, entityType: 'company', entityId: id, after: parsed.data })
    return c.json({ ok: true })
  })
