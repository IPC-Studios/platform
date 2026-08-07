import { Hono } from 'hono'
import { registerRequest, registerResponse, sessionState } from '@ipc/contracts'
import { serializeAccess } from '@ipc/permissions'
import type { AppEnv } from '../../context'
import { requireAuth } from '../../middleware/auth'
import { fail } from '../../middleware/errors'
import { userClient } from '../../lib/supabase'

/**
 * Auth router. The user signs up through Supabase Auth on the client, then hits
 * POST /auth/register once to create their studio (company + owner user) via the
 * atomic register_company_and_admin RPC. GET /auth/session hydrates the app.
 */
export const authRouter = new Hono<AppEnv>()
  // Register needs a valid Supabase session but NOT an existing tenant, so it
  // does its own token check rather than the tenant-resolving requireAuth.
  .post('/register', async (c) => {
    const auth = c.req.header('Authorization') ?? ''
    const token = auth.startsWith('Bearer ') ? auth.slice(7) : ''
    if (!token) fail(401, 'Please sign in to continue.')

    const parsed = registerRequest.safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success) fail(422, 'Please check the form and try again.')

    const supabase = userClient(c.env, token)
    const { data, error } = await supabase
      .rpc('register_company_and_admin', {
        p_company_name: parsed.data.company_name,
        p_admin_name: parsed.data.admin_name,
        p_phone: parsed.data.phone ?? null,
      })
      .single()

    if (error || !data) fail(409, 'We could not create your studio. Please try again.')

    const row = data as { company_id: string; user_id: string; role: 'super_admin' }
    return c.json(
      registerResponse.parse({
        company_id: row.company_id,
        admin_id: row.user_id,
        role: 'super_admin',
      }),
    )
  })

  // Whole-session hydration for an established tenant.
  .get('/session', requireAuth, (c) => {
    const a = c.get('auth')
    return c.json(
      sessionState.parse({
        user_id: a.userId,
        company_id: a.companyId,
        role: a.role,
        is_owner: a.isOwner,
        display_name: a.displayName,
        email: a.email,
        plan_gate: a.planGate,
        plan_expiry: a.planExpiry,
        permissions: serializeAccess(a.access),
      }),
    )
  })
