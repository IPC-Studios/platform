import type { Context, Next } from 'hono'
import { resolveAccess, type AppRole } from '@ipc/permissions'
import type { PlanGate } from '@ipc/contracts'
import type { AppEnv } from '../context'
import { fail } from './errors'
import { userClient } from '../lib/supabase'

function bearer(c: Context<AppEnv>): string {
  const h = c.req.header('Authorization') ?? ''
  const [scheme, token] = h.split(' ')
  if (scheme !== 'Bearer' || !token) fail(401, 'Please sign in to continue.')
  return token
}

/**
 * Resolve identity + tenant + effective access, once per request.
 *   1. verify the Supabase JWT (real user)
 *   2. resolve company_id + role + profile via the `get_auth_context` RPC
 *      (Phase 1 creates it; it reads auth.uid() and returns the tenant row)
 *   3. compose effective permissions with the shared resolver
 */
export async function requireAuth(c: Context<AppEnv>, next: Next) {
  const token = bearer(c)
  const supabase = userClient(c.env, token)

  const { data: userData, error: userErr } = await supabase.auth.getUser()
  if (userErr || !userData.user) fail(401, 'Your session has expired. Please sign in again.')

  const { data: ctx, error: ctxErr } = await supabase.rpc('get_auth_context').single()
  if (ctxErr || !ctx) fail(403, 'No studio is linked to this account.')

  const row = ctx as {
    company_id: string
    role: AppRole
    is_owner: boolean
    display_name: string
    email: string
    plan_expiry: string | null
    plan_gate: PlanGate
    profile_key: string | null
    overrides: { permission_key: string; enabled: boolean }[] | null
  }

  const access = resolveAccess({
    role: row.role,
    isOwner: row.is_owner,
    profileKey: row.profile_key,
    overrides: row.overrides ?? [],
  })

  c.set('auth', {
    userId: userData.user.id,
    companyId: row.company_id,
    role: row.role,
    isOwner: row.is_owner,
    displayName: row.display_name,
    email: row.email,
    planGate: row.plan_gate,
    planExpiry: row.plan_expiry,
    access,
  })

  await next()
}
