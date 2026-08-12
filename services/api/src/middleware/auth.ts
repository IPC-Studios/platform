import type { Context, Next } from 'hono'
import { resolveAccess, type AppRole } from '@ipc/permissions'
import type { PlanGate } from '@ipc/contracts'
import type { AppEnv } from '../context'
import { fail } from './errors'
import { verifyToken } from '../lib/auth-token'
import { withUser } from '../lib/db'

function bearer(c: Context<AppEnv>): string {
  const h = c.req.header('Authorization') ?? ''
  const [scheme, token] = h.split(' ')
  if (scheme !== 'Bearer' || !token) fail(401, 'Please sign in to continue.')
  return token
}

interface AuthContextRow {
  company_id: string
  role: AppRole
  is_owner: boolean
  is_platform_admin: boolean
  display_name: string
  email: string
  plan_expiry: string | null
  plan_gate: PlanGate
  profile_key: string | null
  overrides: { permission_key: string; enabled: boolean }[] | null
}

/**
 * Resolve identity + tenant + effective access, once per request.
 *   1. verify the app JWT locally (no auth server round-trip)
 *   2. run get_auth_context() as the caller inside an RLS-scoped transaction
 *      (withUser sets auth.uid() via the request.jwt.claim.sub GUC)
 *   3. compose effective permissions with the shared resolver
 */
export async function requireAuth(c: Context<AppEnv>, next: Next) {
  const token = bearer(c)
  const uid = await verifyToken(c.env, token)
  if (!uid) fail(401, 'Your session has expired. Please sign in again.')

  const row = await withUser(c.env, uid, async (sql) => {
    const rows = await sql<AuthContextRow[]>`select * from get_auth_context()`
    return rows[0]
  })
  if (!row) fail(403, 'No studio is linked to this account.')

  const access = resolveAccess({
    role: row.role,
    isOwner: row.is_owner,
    profileKey: row.profile_key,
    overrides: row.overrides ?? [],
  })

  c.set('auth', {
    userId: uid,
    companyId: row.company_id,
    role: row.role,
    isOwner: row.is_owner,
    isPlatformAdmin: row.is_platform_admin ?? false,
    displayName: row.display_name,
    email: row.email,
    planGate: row.plan_gate,
    planExpiry: row.plan_expiry,
    access,
  })

  await next()
}
