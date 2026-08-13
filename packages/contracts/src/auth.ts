import { z } from 'zod'
import { email, phone, uuid, isoDateTime } from './shared/primitives'

/**
 * Auth contracts. Identity = Supabase Auth (Firebase dropped).
 * The Supabase session (access token) is the credential; the server resolves
 * company + role from it. These contracts cover only the app-level payloads.
 */

/** Register a brand-new studio: creates the auth user + company + owner admin. */
export const registerRequest = z.object({
  company_name: z.string().trim().min(2).max(120),
  admin_name: z.string().trim().min(2).max(120),
  email,
  password: z.string().min(8).max(200),
  phone: phone.optional(),
})
export type RegisterRequest = z.infer<typeof registerRequest>

/** Email + password sign-in. */
export const loginRequest = z.object({
  email,
  password: z.string().min(1).max(200),
})
export type LoginRequest = z.infer<typeof loginRequest>

/** What /auth/login and /auth/verify return — a bearer access token. */
export const authToken = z.object({
  access_token: z.string(),
  token_type: z.literal('bearer'),
})
export type AuthToken = z.infer<typeof authToken>

/** /auth/register response — email verification is required before sign-in. */
export const registerResult = z.object({
  verification_required: z.literal(true),
  email,
  /** Present only outside production (ENVIRONMENT !== 'production') for tests. */
  verification_token: z.string().optional(),
})
export type RegisterResult = z.infer<typeof registerResult>

/** Confirm an email via the token from the verification link. */
export const verifyEmailRequest = z.object({ token: z.string().min(1) })
export type VerifyEmailRequest = z.infer<typeof verifyEmailRequest>

/** Re-send the verification email. */
export const resendVerificationRequest = z.object({ email })
export type ResendVerificationRequest = z.infer<typeof resendVerificationRequest>

/** Start a password reset. Always answered the same way — no account enumeration. */
export const forgotPasswordRequest = z.object({ email })
export type ForgotPasswordRequest = z.infer<typeof forgotPasswordRequest>

export const forgotPasswordResult = z.object({
  ok: z.literal(true),
  /** Present only outside production (ENVIRONMENT !== 'production') for tests. */
  reset_token: z.string().optional(),
})
export type ForgotPasswordResult = z.infer<typeof forgotPasswordResult>

/** Finish a password reset with the token from the emailed link. */
export const resetPasswordRequest = z.object({
  token: z.string().min(1),
  password: z.string().min(8).max(200),
})
export type ResetPasswordRequest = z.infer<typeof resetPasswordRequest>

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
