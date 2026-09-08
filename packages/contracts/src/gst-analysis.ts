import { z } from 'zod'
import { isoDate, money } from './shared/primitives'

export const gstAnalysisRequest = z.object({
  start_date: isoDate,
  end_date: isoDate,
})
export type GstAnalysisRequest = z.infer<typeof gstAnalysisRequest>

export const gstAnalysis = z.object({
  period_start: isoDate,
  period_end: isoDate,
  total_income: money,
  total_expenses: money,
  gst_collected: money,
  gst_paid: money,
  net_gst_liability: money,
  reverse_charge: money,
  input_tax_credit: money,
  by_state: z.array(
    z.object({
      state: z.string(),
      income: money,
      gst: money,
    }),
  ),
  by_gst_rate: z.array(
    z.object({
      rate: z.number(),
      taxable_amount: money,
      cgst: money,
      sgst: money,
      igst: money,
    }),
  ),
})
export type GstAnalysis = z.infer<typeof gstAnalysis>

export const financialFilters = z.object({
  start_date: isoDate.optional(),
  end_date: isoDate.optional(),
  category: z.string().optional(),
  project_id: z.string().uuid().optional(),
})
export type FinancialFilters = z.infer<typeof financialFilters>
