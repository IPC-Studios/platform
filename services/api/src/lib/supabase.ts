import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import type { Context } from 'hono'
import type { AppEnv, Env } from '../context'

/** Client bound to the caller's JWT — subject to RLS. Use for tenant reads/writes. */
export function userClient(env: Env, accessToken: string): SupabaseClient {
  return createClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

/** The request's RLS-scoped client, built from the caller's bearer token. */
export function requestClient(c: Context<AppEnv>): SupabaseClient {
  const token = (c.req.header('Authorization') ?? '').slice(7)
  return userClient(c.env, token)
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
