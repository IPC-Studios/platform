import { z } from 'zod'
import { uuid, isoDateTime } from './shared/primitives'

export const leadStatus = z.enum(['new', 'contacted', 'qualified', 'converted', 'lost'])
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
  created_at: isoDateTime,
})
export type CrmLead = z.infer<typeof crmLead>

export const updateLeadRequest = z.object({
  status: leadStatus.optional(),
  assigned_to: uuid.nullable().optional(),
  notes: z.string().max(2000).optional(),
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
