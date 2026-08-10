import type { PlanGate } from '@ipc/contracts'
import type { AppRole, ResolvedAccess } from '@ipc/permissions'

/** Secrets + vars from the runtime env (process.env under Bun). */
export interface Env {
  ENVIRONMENT: string
  /** Postgres connection string the API connects as (the `authenticator` role). */
  DATABASE_URL: string
  /** HS256 secret for signing/verifying app JWTs (replaces GoTrue). */
  JWT_SECRET: string
  CRON_SECRET: string
  // TEMP: still read by lib/supabase.ts until all routers move to lib/db.ts.
  SUPABASE_URL: string
  SUPABASE_ANON_KEY: string
  SUPABASE_SERVICE_ROLE_KEY: string
  RAZORPAY_KEY_ID: string
  RAZORPAY_KEY_SECRET: string
  RAZORPAY_WEBHOOK_SECRET: string
  /** Comma-separated allowlist of browser origins; empty = allow all (dev). */
  ALLOWED_ORIGINS: string
}

/**
 * Per-request auth context, resolved once by middleware and read everywhere.
 * Tenancy lives HERE, never in handlers — the repository layer takes
 * `companyId` from this and refuses a query without it.
 */
export interface AuthContext {
  userId: string
  companyId: string
  role: AppRole
  isOwner: boolean
  /** Member of the cross-tenant platform_admins allowlist (vendor console). */
  isPlatformAdmin: boolean
  displayName: string
  email: string
  planGate: PlanGate
  planExpiry: string | null
  access: ResolvedAccess
}

/** Hono generics: bind Env + typed context Variables. */
export interface AppEnv {
  Bindings: Env
  Variables: {
    auth: AuthContext
  }
}
