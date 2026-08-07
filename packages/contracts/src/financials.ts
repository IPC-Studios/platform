import { z } from 'zod'
import { uuid, isoDate, money } from './shared/primitives'

export const gstTreatment = z.enum(['non_gst', 'gst_applicable', 'exempt', 'reverse_charge'])

export const expense = z.object({
  id: uuid,
  project_id: uuid.nullable(),
  category: z.string().nullable(),
  description: z.string().nullable(),
  amount: money,
  expense_date: isoDate,
  gst_treatment: gstTreatment,
  is_fixed_overhead: z.boolean(),
})
export type Expense = z.infer<typeof expense>

export const createExpenseRequest = z.object({
  project_id: uuid.nullable().default(null),
  category: z.string().max(80).optional(),
  description: z.string().max(400).optional(),
  amount: money,
  expense_date: isoDate.optional(),
  gst_treatment: gstTreatment.default('non_gst'),
  is_fixed_overhead: z.boolean().default(false),
})
export type CreateExpenseRequest = z.infer<typeof createExpenseRequest>

/** One row of the project_financials view + derived gross/balance. */
export const projectFinancials = z.object({
  project_id: uuid,
  name: z.string(),
  revenue: money,
  received: money,
  direct_team_cost: money,
  project_expenses: money,
  gross_profit: z.number(),
  balance_pending: money,
})
export type ProjectFinancials = z.infer<typeof projectFinancials>
