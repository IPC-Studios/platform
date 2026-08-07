import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import type { Env } from '../context'

/** Client bound to the caller's JWT — subject to RLS. Use for tenant reads/writes. */
export function userClient(env: Env, accessToken: string): SupabaseClient {
  return createClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

/**
 * Service-role client — BYPASSES RLS. Only for the narrow set that genuinely
 * needs it: payments, webhooks, cron, cross-tenant platform ops. Never expose
 * to a tenant-scoped handler.
 */
export function serviceClient(env: Env): SupabaseClient {
  return createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}
