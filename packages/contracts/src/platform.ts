import { z } from 'zod'
import { email, uuid, isoDateTime } from './shared/primitives'
import { planGate } from './auth'

/**
 * Platform console contracts — the cross-tenant vendor view. Every payload here
 * is served only to `platform_admins`; the row shapes mirror the security-definer
 * RPCs `platform_list_studios` / `platform_usage_summary` (migration 0019).
 */

export const platformStudio = z.object({
  id: uuid,
  name: z.string(),
  owner_email: email.nullable(),
  plan_gate: planGate,
  plan_expiry: isoDateTime.nullable(),
  user_count: z.coerce.number().int(),
  project_count: z.coerce.number().int(),
  created_at: isoDateTime,
})
export type PlatformStudio = z.infer<typeof platformStudio>

export const platformStudioList = z.array(platformStudio)

export const platformUsage = z.object({
  studio_count: z.coerce.number().int(),
  active_studio_count: z.coerce.number().int(),
  total_users: z.coerce.number().int(),
  revenue_last_30d: z.coerce.number(),
})
export type PlatformUsage = z.infer<typeof platformUsage>

/** A vendor plan action on one tenant. `months` applies only to `extend`. */
export const platformPlanAction = z
  .object({
    action: z.enum(['extend', 'expire', 'trial']),
    months: z.number().int().min(1).max(60).optional(),
  })
  .refine((v) => v.action !== 'extend' || typeof v.months === 'number', {
    message: 'months is required to extend',
    path: ['months'],
  })
export type PlatformPlanAction = z.infer<typeof platformPlanAction>
