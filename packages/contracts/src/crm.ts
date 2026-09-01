import { z } from 'zod'
import { uuid, isoDateTime } from './shared/primitives'

export const leadStatus = z.enum([
  'new',
  'contacted',
  'qualified',
  'proposal_sent',
  'converted',
  'lost',
])
export type LeadStatus = z.infer<typeof leadStatus>

export const leadSource = z.enum(['facebook', 'webform', 'referral', 'manual', 'enquiry'])

export const crmLead = z.object({
  id: uuid,
  name: z.string().nullable(),
  phone: z.string().nullable(),
  email: z.string().nullable(),
  source: leadSource,
  status: leadStatus,
  assigned_to: uuid.nullable(),
  assignee_name: z.string().nullable(),
  notes: z.string().nullable(),
  /** The next promised contact. Null means nobody has agreed to call back. */
  follow_up_at: isoDateTime.nullable(),
  last_contacted_at: isoDateTime.nullable(),
  converted_at: isoDateTime.nullable(),
  is_hot: z.boolean(),
  created_at: isoDateTime,
})
export type CrmLead = z.infer<typeof crmLead>

export const updateLeadRequest = z.object({
  name: z.string().trim().max(160).nullable().optional(),
  phone: z.string().trim().max(30).nullable().optional(),
  email: z.string().trim().max(200).nullable().optional(),
  status: leadStatus.optional(),
  assigned_to: uuid.nullable().optional(),
  notes: z.string().max(2000).nullable().optional(),
  follow_up_at: isoDateTime.nullable().optional(),
  is_hot: z.boolean().optional(),
})
export type UpdateLeadRequest = z.infer<typeof updateLeadRequest>

/** Public webhook body (Meta / web form). */
export const captureLeadRequest = z.object({
  name: z.string().max(160).optional(),
  phone: z.string().max(30),
  email: z.string().max(200).optional(),
  meta: z.record(z.unknown()).optional(),
})
export type CaptureLeadRequest = z.infer<typeof captureLeadRequest>

/** Adding a lead by hand. The phone is the identity — everything else can wait. */
export const createLeadRequest = z.object({
  name: z.string().trim().max(160).optional(),
  phone: z.string().trim().min(6).max(30),
  email: z.string().trim().max(200).optional(),
  source: leadSource.default('manual'),
  notes: z.string().max(2000).optional(),
  assigned_to: uuid.nullable().optional(),
  follow_up_at: isoDateTime.nullable().optional(),
})
export type CreateLeadRequest = z.infer<typeof createLeadRequest>

/** One member of the round-robin rota new leads are handed to. */
export const distributionRule = z.object({
  id: uuid,
  user_id: uuid,
  user_name: z.string().nullable(),
  priority: z.number().int(),
  is_active: z.boolean(),
  lead_count: z.number().int(),
})
export type DistributionRule = z.infer<typeof distributionRule>
