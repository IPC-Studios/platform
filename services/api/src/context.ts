import type { PlanGate } from '@ipc/contracts'
import type { AppRole, ResolvedAccess } from '@ipc/permissions'

/** Secrets + vars bound to the Worker. */
export interface Env {
  ENVIRONMENT: string
  SUPABASE_URL: string
  SUPABASE_ANON_KEY: string
  SUPABASE_SERVICE_ROLE_KEY: string
  CRON_SECRET: string
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
