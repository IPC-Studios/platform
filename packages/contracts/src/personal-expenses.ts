import { z } from 'zod'
import { uuid, isoDate, isoDateTime, money, gstRate } from './shared/primitives'

export const personalExpenseCategory = z.enum([
  'travel',
  'food',
  'accommodation',
  'supplies',
  'communication',
  'equipment',
  'other',
])
export type PersonalExpenseCategory = z.infer<typeof personalExpenseCategory>

export const PERSONAL_EXPENSE_CATEGORIES: readonly PersonalExpenseCategory[] = personalExpenseCategory.options

/** A vendor, freelancer, or other party an expense was paid to or received from. */
export const party = z.object({
  id: uuid,
  name: z.string(),
  kind: z.enum(['vendor', 'freelancer', 'other']),
})
export type Party = z.infer<typeof party>

export const createPartyRequest = z.object({
  name: z.string().trim().min(1).max(120),
  kind: z.enum(['vendor', 'freelancer', 'other']).default('vendor'),
})
export type CreatePartyRequest = z.infer<typeof createPartyRequest>

export const updatePartyRequest = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  kind: z.enum(['vendor', 'freelancer', 'other']).optional(),
})
export type UpdatePartyRequest = z.infer<typeof updatePartyRequest>

export const personalExpense = z.object({
  id: uuid,
  company_id: uuid,
  user_id: uuid,
  party_id: uuid.nullable(),
  party_name: z.string().nullable(),
  amount: money,
  expense_date: isoDate,
  category: z.string().nullable(),
  gst_treatment: z.string(),
  gst_rate: gstRate.nullable(),
  description: z.string().nullable(),
  created_at: isoDateTime,
})
export type PersonalExpense = z.infer<typeof personalExpense>

export const personalExpenseSummary = z.object({
  total_count: z.number().int(),
  total_amount: money,
  this_month_amount: money,
  this_month_count: z.number().int(),
})
export type PersonalExpenseSummary = z.infer<typeof personalExpenseSummary>

export const personalExpenseList = z.object({
  items: z.array(personalExpense),
  summary: personalExpenseSummary,
  next_cursor: isoDateTime.nullable().default(null),
})
export type PersonalExpenseList = z.infer<typeof personalExpenseList>

export const createPersonalExpenseRequest = z.object({
  party_id: uuid.nullish(),
  amount: money.refine((v) => v > 0, 'amount must be positive'),
  expense_date: isoDate.optional(),
  category: personalExpenseCategory.nullish(),
  gst_treatment: z.enum(['non_gst', 'gst_applicable', 'exempt', 'reverse_charge']).default('non_gst'),
  gst_rate: gstRate.nullish(),
  description: z.string().trim().max(2000).nullish(),
})
export type CreatePersonalExpenseRequest = z.infer<typeof createPersonalExpenseRequest>

export const updatePersonalExpenseRequest = createPersonalExpenseRequest
export type UpdatePersonalExpenseRequest = z.infer<typeof updatePersonalExpenseRequest>

export const personalExpenseReport = z.object({
  period_start: isoDate,
  period_end: isoDate,
  total_amount: money,
  by_category: z.array(
    z.object({
      category: z.string().nullable(),
      amount: money,
      count: z.number().int(),
    }),
  ),
  daily_breakdown: z.array(
    z.object({
      date: isoDate,
      amount: money,
      count: z.number().int(),
    }),
  ),
})
export type PersonalExpenseReport = z.infer<typeof personalExpenseReport>

export const personalExpenseReportRequest = z.object({
  start_date: isoDate,
  end_date: isoDate,
})
export type PersonalExpenseReportRequest = z.infer<typeof personalExpenseReportRequest>
