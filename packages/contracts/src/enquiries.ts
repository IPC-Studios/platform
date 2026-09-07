import { z } from 'zod'
import { uuid, isoDateTime } from './shared/primitives'

/**
 * An enquiry is what arrives; a lead is what someone works.
 *
 * Most enquiries are never worked at all, which is exactly why they are not
 * leads — a lead list nobody trusts is a lead list nobody opens. Converting
 * moves one across and records which lead it became.
 */
export const enquiryStatus = z.enum(['new', 'reviewed', 'contacted', 'converted', 'closed'])
export type EnquiryStatus = z.infer<typeof enquiryStatus>

/** Statuses that still want someone's attention. */
export const OPEN_ENQUIRY_STATUSES: readonly EnquiryStatus[] = ['new', 'reviewed', 'contacted']

/** Offered in the picker; the field itself is free text. */
export const ENQUIRY_SOURCES = [
  'website',
  'phone',
  'walk_in',
  'instagram',
  'facebook',
  'referral',
  'other',
] as const

export const enquiry = z.object({
  id: uuid,
  name: z.string(),
  phone: z.string().nullable(),
  email: z.string().nullable(),
  message: z.string().nullable(),
  source: z.string().nullable(),
  enquiry_status: enquiryStatus,
  assigned_to: uuid.nullable(),
  assigned_to_name: z.string().nullable(),
  converted_lead_id: uuid.nullable(),
  created_at: isoDateTime,
})
export type Enquiry = z.infer<typeof enquiry>

export const enquirySummary = z.object({
  total_count: z.number().int(),
  open_count: z.number().int(),
  new_count: z.number().int(),
  reviewed_count: z.number().int(),
  contacted_count: z.number().int(),
  converted_count: z.number().int(),
  closed_count: z.number().int(),
})
export type EnquirySummary = z.infer<typeof enquirySummary>

export const enquiryList = z.object({
  items: z.array(enquiry),
  summary: enquirySummary,
})
export type EnquiryList = z.infer<typeof enquiryList>

export const saveEnquiryRequest = z.object({
  name: z.string().trim().min(2).max(160),
  phone: z.string().trim().max(40).nullish(),
  email: z.string().trim().max(200).nullish(),
  message: z.string().trim().max(2000).nullish(),
  source: z.string().trim().max(60).nullish(),
  enquiry_status: enquiryStatus.default('new'),
  assigned_to: uuid.nullish(),
})
export type SaveEnquiryRequest = z.infer<typeof saveEnquiryRequest>

export const convertEnquiryRequest = z.object({
  notes: z.string().trim().max(2000).nullish(),
})
export type ConvertEnquiryRequest = z.infer<typeof convertEnquiryRequest>

export const convertEnquiryResponse = z.object({ lead_id: uuid })
export type ConvertEnquiryResponse = z.infer<typeof convertEnquiryResponse>
