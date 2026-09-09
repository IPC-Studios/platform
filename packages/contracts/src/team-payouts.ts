import { z } from 'zod'
import { uuid, isoDate, isoDateTime, money } from './shared/primitives'

export const payoutStatus = z.enum(['pending', 'processing', 'completed', 'failed'])
export type PayoutStatus = z.infer<typeof payoutStatus>

export const teamPayout = z.object({
  id: uuid,
  company_id: uuid,
  user_id: uuid,
  user_name: z.string().nullable(),
  amount: money,
  period_start: isoDate,
  period_end: isoDate,
  status: payoutStatus,
  payment_mode: z.string().nullable(),
  reference: z.string().nullable(),
  notes: z.string().nullable(),
  created_at: isoDateTime,
})
export type TeamPayout = z.infer<typeof teamPayout>

export const teamPayoutSummary = z.object({
  total_payouts: z.number().int(),
  total_amount: money,
  pending_amount: money,
  completed_amount: money,
  this_month_amount: money,
})
export type TeamPayoutSummary = z.infer<typeof teamPayoutSummary>

export const teamPayoutList = z.object({
  items: z.array(teamPayout),
  summary: teamPayoutSummary,
})
export type TeamPayoutList = z.infer<typeof teamPayoutList>

export const createTeamPayoutRequest = z.object({
  user_id: uuid,
  amount: money.refine((v) => v > 0, 'amount must be positive'),
  period_start: isoDate,
  period_end: isoDate,
  payment_mode: z.string().trim().max(40).nullish(),
  reference: z.string().trim().max(120).nullish(),
  notes: z.string().trim().max(500).nullish(),
}).refine((d) => d.period_end >= d.period_start, { message: 'period_end must be on or after period_start', path: ['period_end'] })
export type CreateTeamPayoutRequest = z.infer<typeof createTeamPayoutRequest>

export const updateTeamPayoutRequest = z.object({
  amount: money.refine((v) => v > 0, 'amount must be positive').optional(),
  period_start: isoDate.optional(),
  period_end: isoDate.optional(),
  payment_mode: z.string().trim().max(40).nullable().optional(),
  reference: z.string().trim().max(120).nullable().optional(),
  notes: z.string().trim().max(500).nullable().optional(),
})
export type UpdateTeamPayoutRequest = z.infer<typeof updateTeamPayoutRequest>

/**
 * The shoot-derived tracker, kept alongside the manual payouts above rather
 * than replacing them -- a payout tied to an actual booked shoot, settled
 * through a cash ledger instead of typed in from scratch. This never
 * mutates the slot's own cost fields or feeds project profit; it is
 * bookkeeping for what was actually paid, nothing else reads it.
 */
export const payoutEntryType = z.enum(['payment', 'reversal', 'adjustment'])
export type PayoutEntryType = z.infer<typeof payoutEntryType>

export const payoutSettlement = z.object({
  id: uuid,
  slot_id: uuid,
  member_uid: uuid,
  project_id: uuid.nullable(),
  shoot_id: uuid.nullable(),
  /** Snapshotted from the slot's cost when this entry was recorded, not a running total. */
  amount_due: money,
  /** Signed: positive for a payment or adjustment, negative for a reversal. */
  amount_paid: z.number(),
  paid_date: isoDate,
  payment_mode: z.string().nullable(),
  payment_reference: z.string().nullable(),
  notes: z.string().nullable(),
  entry_type: payoutEntryType,
  reverses_settlement_id: uuid.nullable(),
  created_by: uuid.nullable(),
  created_at: isoDateTime,
})
export type PayoutSettlement = z.infer<typeof payoutSettlement>

export const payoutSettlementAggregate = z.object({
  slot_id: uuid,
  /** Running total across every entry for this slot -- reversals already subtracted. */
  paid_total: z.number(),
  last_paid_date: isoDate.nullable(),
  last_reference: z.string().nullable(),
  entries_count: z.number().int(),
})
export type PayoutSettlementAggregate = z.infer<typeof payoutSettlementAggregate>

export const payoutSettlementList = z.object({
  entries: z.array(payoutSettlement),
  aggregates: z.array(payoutSettlementAggregate),
})
export type PayoutSettlementList = z.infer<typeof payoutSettlementList>

export const createPayoutSettlementRequest = z.object({
  slot_id: uuid,
  amount_paid: money.refine((v) => v > 0, 'amount_paid must be positive'),
  paid_date: isoDate.optional(),
  payment_mode: z.string().trim().max(50).nullish(),
  payment_reference: z.string().trim().max(100).nullish(),
  notes: z.string().trim().max(500).nullish(),
  entry_type: payoutEntryType.default('payment'),
  reverses_settlement_id: uuid.nullish(),
})
export type CreatePayoutSettlementRequest = z.infer<typeof createPayoutSettlementRequest>

export const createPayoutSettlementResponse = z.object({
  id: uuid,
  paid_total: z.number(),
  amount_due: money,
})
export type CreatePayoutSettlementResponse = z.infer<typeof createPayoutSettlementResponse>
