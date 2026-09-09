import { z } from 'zod'
import { uuid, isoDate, isoDateTime, money } from './shared/primitives'

export const profitabilitySortBy = z.enum([
  'project_name',
  'client_name',
  'total_cost',
  'paid_income',
  'receivables',
  'company_expense_total',
  'gross_profit',
  'gross_margin',
  'collection_rate',
  'status',
  'created_at',
])
export type ProfitabilitySortBy = z.infer<typeof profitabilitySortBy>

export const profitabilityReportQuery = z.object({
  date_from: isoDate.nullish(),
  date_to: isoDate.nullish(),
  project_id: uuid.nullish(),
  client_id: uuid.nullish(),
  status: z.string().nullish(),
  search: z.string().nullish(),
  sort_by: profitabilitySortBy.default('created_at'),
  sort_direction: z.enum(['asc', 'desc']).default('desc'),
  page: z.number().int().min(1).default(1),
  page_size: z.number().int().min(10).max(200).default(50),
})
export type ProfitabilityReportQuery = z.infer<typeof profitabilityReportQuery>

export const profitabilityBalanceStatus = z.enum(['pending', 'settled', 'over_collected'])
export const profitabilityStatus = z.enum(['loss', 'low_margin', 'healthy', 'strong'])

export const profitabilityItem = z.object({
  project_id: uuid,
  project_name: z.string(),
  client_id: uuid.nullable(),
  client_name: z.string().nullable(),
  project_status: z.string().nullable(),
  created_at: isoDateTime,
  project_total_value: money,
  paid_income: money,
  // Signed: a project paid past its full value shows a negative receivable.
  receivables: z.number(),
  company_expense_total: money,
  gross_profit: z.number(),
  expected_project_profit: z.number(),
  gross_margin: z.number(),
  expected_margin: z.number(),
  collection_rate: z.number(),
  expense_ratio: z.number(),
  balance_status: profitabilityBalanceStatus,
  profitability_status: profitabilityStatus,
  attention_flags: z.array(z.string()),
})
export type ProfitabilityItem = z.infer<typeof profitabilityItem>

export const profitabilitySummary = z.object({
  project_count: z.number().int(),
  total_project_value: money,
  total_paid_income: money,
  total_receivables: z.number(),
  total_company_expenses: money,
  total_gross_profit: z.number(),
  average_gross_margin: z.number(),
  average_collection_rate: z.number(),
  loss_project_count: z.number().int(),
  pending_project_count: z.number().int(),
  over_collected_project_count: z.number().int(),
})
export type ProfitabilitySummary = z.infer<typeof profitabilitySummary>

export const profitabilityReport = z.object({
  items: z.array(profitabilityItem),
  summary: profitabilitySummary,
  pagination: z.object({
    page: z.number().int(),
    page_size: z.number().int(),
    total_count: z.number().int(),
    total_pages: z.number().int(),
  }),
})
export type ProfitabilityReport = z.infer<typeof profitabilityReport>
