import { z } from 'zod'
import { email, phone, uuid, isoDateTime } from './shared/primitives'

/**
 * Auth contracts. Identity = Supabase Auth (Firebase dropped).
 * The Supabase session (access token) is the credential; the server resolves
 * company + role from it. These contracts cover only the app-level payloads.
 */

/** Register a brand-new studio: creates company + owner admin atomically. */
export const registerRequest = z.object({
  company_name: z.string().trim().min(2).max(120),
  admin_name: z.string().trim().min(2).max(120),
  email,
  phone: phone.optional(),
})
export type RegisterRequest = z.infer<typeof registerRequest>

export const registerResponse = z.object({
  company_id: uuid,
  admin_id: uuid,
  role: z.literal('super_admin'),
})
export type RegisterResponse = z.infer<typeof registerResponse>

/** Plan-gate state resolved for the current company. */
export const planGate = z.enum(['active', 'grace', 'grandfathered', 'expired'])
export type PlanGate = z.infer<typeof planGate>

/** The whole-session payload the client hydrates from after login. */
export const sessionState = z.object({
  user_id: uuid,
  company_id: uuid,
  role: z.enum(['platform_admin', 'super_admin', 'admin', 'manager', 'employee', 'none']),
  is_owner: z.boolean(),
  /** Member of the cross-tenant platform_admins allowlist (vendor console). */
  is_platform_admin: z.boolean().default(false),
  display_name: z.string(),
  email,
  plan_gate: planGate,
  plan_expiry: isoDateTime.nullable(),
  /** Effective module permission keys, pre-composed server-side. */
  permissions: z.array(z.string()),
})
export type SessionState = z.infer<typeof sessionState>
