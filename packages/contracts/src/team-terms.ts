import { z } from 'zod'
import { uuid, isoDate, isoDateTime } from './shared/primitives'

/**
 * Team terms: the agreement a studio puts in front of the crew it books.
 *
 * The client-facing equivalent lives in `terms.ts`. This one differs in two
 * ways that matter: it hangs off a shoot rather than a project, and it can be
 * a briefing nobody signs as well as an undertaking somebody does.
 */
export const teamTermsMode = z.enum(['send_only', 'acknowledgement_required'])
export type TeamTermsMode = z.infer<typeof teamTermsMode>

export const teamTermsCategory = z.enum([
  'pre_production',
  'production',
  'post_production',
  'general',
  'business_protection',
])
export type TeamTermsCategory = z.infer<typeof teamTermsCategory>

export const teamTermsStatus = z.enum([
  'draft',
  'sent',
  'viewed',
  'acknowledged',
  'expired',
  'revoked',
])
export type TeamTermsStatus = z.infer<typeof teamTermsStatus>

export const teamTermsTemplate = z.object({
  id: uuid,
  title: z.string(),
  description: z.string().nullable(),
  body: z.string(),
  mode: teamTermsMode,
  validity_days: z.number().int().nullable(),
  category: teamTermsCategory.nullable(),
  version: z.number().int(),
  is_active: z.boolean(),
  archived_at: isoDateTime.nullable(),
  /** Job roles this template covers, for the default pick when sending. */
  role_ids: z.array(uuid),
  /** How many sends have gone out under it — the reason not to delete lightly. */
  send_count: z.number().int(),
})
export type TeamTermsTemplate = z.infer<typeof teamTermsTemplate>

export const saveTeamTermsTemplateRequest = z.object({
  title: z.string().trim().min(2).max(160),
  description: z.string().trim().max(500).nullish(),
  body: z.string().trim().min(20).max(40000),
  mode: teamTermsMode.default('acknowledgement_required'),
  validity_days: z.number().int().min(1).max(365).nullish(),
  category: teamTermsCategory.nullish(),
  is_active: z.boolean().default(true),
  role_ids: z.array(uuid).max(40).default([]),
})
export type SaveTeamTermsTemplateRequest = z.infer<typeof saveTeamTermsTemplateRequest>

export const teamTermsSend = z.object({
  id: uuid,
  shoot_id: uuid.nullable(),
  shoot_name: z.string().nullable(),
  shoot_date: isoDate.nullable(),
  project_id: uuid.nullable(),
  user_id: uuid.nullable(),
  role_name: z.string().nullable(),
  template_id: uuid.nullable(),
  template_title: z.string().nullable(),
  template_version: z.number().int().nullable(),
  mode: teamTermsMode,
  recipient_name: z.string(),
  recipient_email: z.string().nullable(),
  recipient_phone: z.string().nullable(),
  status: teamTermsStatus,
  sent_via: z.string().nullable(),
  sent_at: isoDateTime.nullable(),
  viewed_at: isoDateTime.nullable(),
  acknowledged_at: isoDateTime.nullable(),
  acknowledged_by_name: z.string().nullable(),
  expires_at: isoDateTime.nullable(),
  created_at: isoDateTime,
})
export type TeamTermsSend = z.infer<typeof teamTermsSend>

/**
 * Sending is one call: it renders the body, stores the send and issues the
 * link. `send_email` is a request, not a promise — the response says what
 * actually happened, because a studio with no Resend key still needs the link
 * to copy into WhatsApp.
 */
export const sendTeamTermsRequest = z.object({
  shoot_id: uuid,
  template_id: uuid,
  recipient_name: z.string().trim().min(1).max(160),
  recipient_email: z.string().trim().max(200).nullish(),
  recipient_phone: z.string().trim().max(40).nullish(),
  user_id: uuid.nullish(),
  role_id: uuid.nullish(),
  role_name: z.string().trim().max(80).nullish(),
  send_email: z.boolean().default(false),
})
export type SendTeamTermsRequest = z.infer<typeof sendTeamTermsRequest>

export const sendTeamTermsResponse = z.object({
  send_id: uuid,
  link: z.string(),
  expires_at: isoDateTime.nullable(),
  /** 'sent' | 'skipped' | 'failed' — the email, told honestly. */
  email: z.enum(['sent', 'skipped', 'failed']),
})
export type SendTeamTermsResponse = z.infer<typeof sendTeamTermsResponse>

/** What the crew member sees on the public link. No ids, no internals. */
export const publicTeamTerms = z.object({
  status: teamTermsStatus,
  mode: teamTermsMode,
  recipient_name: z.string(),
  role_name: z.string().nullable(),
  rendered_body: z.string(),
  acknowledged_at: isoDateTime.nullable(),
  acknowledged_by_name: z.string().nullable(),
  expires_at: isoDateTime.nullable(),
  shoot_name: z.string().nullable(),
  shoot_date: isoDate.nullable(),
  project_name: z.string().nullable(),
  company_name: z.string().nullable(),
})
export type PublicTeamTerms = z.infer<typeof publicTeamTerms>

export const acknowledgeTeamTermsRequest = z.object({
  name: z.string().trim().min(2).max(160),
})
export type AcknowledgeTeamTermsRequest = z.infer<typeof acknowledgeTeamTermsRequest>
