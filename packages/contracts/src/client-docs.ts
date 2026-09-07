import { z } from 'zod'
import { uuid, isoDate, isoDateTime, money } from './shared/primitives'

/**
 * The three documents a studio hands a client on a link: what it will cost,
 * what has been paid, and where the finished work is.
 *
 * All three read through a token and none of them require an account. The
 * crew-facing equivalent is `team-terms.ts`.
 */
export const quotationLine = z.object({
  title: z.string(),
  chargeable: z.boolean(),
  amount: money,
})
export type QuotationLine = z.infer<typeof quotationLine>

/**
 * Frozen at the moment it was issued. A deliverable added next week must not
 * change the quotation somebody already accepted, so the page reads this
 * snapshot rather than the project.
 */
export const quotationSnapshot = z.object({
  items: z.array(quotationLine),
  package_cost: money,
  add_ons: money,
  total: money,
  project_name: z.string(),
})
export type QuotationSnapshot = z.infer<typeof quotationSnapshot>

export const issueQuotationRequest = z.object({
  project_id: uuid,
  notes: z.string().trim().max(1000).nullish(),
})
export type IssueQuotationRequest = z.infer<typeof issueQuotationRequest>

export const issuedLink = z.object({ link: z.string() })
export type IssuedLink = z.infer<typeof issuedLink>

export const issueReceiptRequest = z.object({ payment_id: uuid })
export type IssueReceiptRequest = z.infer<typeof issueReceiptRequest>

export const publicQuotation = z.object({
  snapshot: quotationSnapshot,
  notes: z.string().nullable(),
  accepted_at: isoDateTime.nullable(),
  accepted_by_name: z.string().nullable(),
  declined_at: isoDateTime.nullable(),
  client_name: z.string().nullable(),
  company_name: z.string().nullable(),
})
export type PublicQuotation = z.infer<typeof publicQuotation>

export const respondToQuotationRequest = z.object({
  accept: z.boolean(),
  /** Required to accept — a name is the signature. Declining needs nothing. */
  name: z.string().trim().max(160).nullish(),
})
export type RespondToQuotationRequest = z.infer<typeof respondToQuotationRequest>

export const publicReceipt = z.object({
  amount: money,
  paid_on: isoDate,
  mode: z.string().nullable(),
  reference: z.string().nullable(),
  project_name: z.string().nullable(),
  client_name: z.string().nullable(),
  company_name: z.string().nullable(),
  total_cost: money,
  received_total: money,
})
export type PublicReceipt = z.infer<typeof publicReceipt>

export const publicDelivery = z.object({
  submission_link: z.string().nullable(),
  notes: z.string().nullable(),
  delivered_at: isoDateTime.nullable(),
  project_name: z.string().nullable(),
  client_name: z.string().nullable(),
  company_name: z.string().nullable(),
})
export type PublicDelivery = z.infer<typeof publicDelivery>
