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
