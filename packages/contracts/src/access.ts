import { z } from 'zod'

/** One permission override: a module key or "module.action", toggled on/off. */
export const accessOverride = z.object({
  permission_key: z.string().min(1),
  enabled: z.boolean(),
})
export type AccessOverride = z.infer<typeof accessOverride>

/** Current stored access for a user (raw inputs, not the resolved set). */
export const userAccess = z.object({
  profile_key: z.string().nullable(),
  overrides: z.array(accessOverride),
})
export type UserAccess = z.infer<typeof userAccess>

/** Owner sets a user's profile + overrides. profile_key null = role defaults. */
export const setUserAccessRequest = z.object({
  profile_key: z.string().nullable(),
  overrides: z.array(accessOverride).default([]),
})
export type SetUserAccessRequest = z.infer<typeof setUserAccessRequest>
