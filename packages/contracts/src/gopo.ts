import { z } from 'zod'
import { uuid, isoDate, money } from './shared/primitives'

export const gopoScoreCard = z.object({
  health_score: z.number().min(0).max(100),
  health_label: z.enum(['excellent', 'good', 'fair', 'poor', 'critical']),
  total_revenue: money,
  total_received: money,
  total_expenses: money,
  total_direct_team_cost: money,
  // Signed: costs can exceed revenue. `money` is nonnegative, so using it
  // here rejected every loss-making studio and blanked the dashboard.
  net_profit: z.number(),
  // Can exceed 100 when a client pays in advance of invoiced revenue.
  collection_rate: z.number().min(0),
  profit_margin: z.number(),
  outstanding_balance: money,
})
export type GopoScoreCard = z.infer<typeof gopoScoreCard>

export const gopoExpenseBreakdown = z.object({
  category: z.string(),
  amount: money,
  percentage: z.number().min(0).max(100),
  count: z.number().int(),
})
export type GopoExpenseBreakdown = z.infer<typeof gopoExpenseBreakdown>

export const gopoProjectPerformance = z.object({
  project_id: uuid,
  project_name: z.string(),
  revenue: money,
  received: money,
  direct_team_cost: money,
  project_expenses: money,
  gross_profit: z.number(),
  balance_pending: money,
  profit_margin: z.number(),
  status: z.string(),
})
export type GopoProjectPerformance = z.infer<typeof gopoProjectPerformance>

export const gopoAttentionItem = z.object({
  kind: z.enum(['overdue_payment', 'high_expense', 'low_margin', 'no_payment', 'negative_profit']),
  severity: z.enum(['info', 'warning', 'critical']),
  message: z.string(),
  project_id: uuid.nullable(),
  project_name: z.string().nullable(),
  // Negative for the negative_profit item, which reports the loss.
  amount: z.number().nullable(),
})
export type GopoAttentionItem = z.infer<typeof gopoAttentionItem>

export const gopoRecentActivity = z.object({
  date: isoDate,
  description: z.string(),
  amount: money,
  type: z.enum(['income', 'expense', 'refund']),
})
export type GopoRecentActivity = z.infer<typeof gopoRecentActivity>

export const gopoSummary = z.object({
  score_card: gopoScoreCard,
  expense_breakdown: z.array(gopoExpenseBreakdown),
  project_performance: z.array(gopoProjectPerformance),
  attention_items: z.array(gopoAttentionItem),
  recent_activity: z.array(gopoRecentActivity),
  // Lovable parity: filters + cash/pending split + signals. All optional.
  cash_received: z.number().nullish(),
  pending_receivable: z.number().nullish(),
  company_expenses: z.number().nullish(),
  personal_expenses: z.number().nullish(),
  salary_cost: z.number().nullish(),
  gst_liability: z.number().nullish(),
  rcm_liability: z.number().nullish(),
  top_projects: z.array(gopoProjectPerformance).nullish(),
  bottom_projects: z.array(gopoProjectPerformance).nullish(),
  attention_count: z.number().int().nullish(),
  signals: z.array(z.string()).nullish(),
})
export type GopoSummary = z.infer<typeof gopoSummary>

export const gopoQuery = z.object({
  start_date: z.string().nullish(),
  end_date: z.string().nullish(),
  include_salaries: z.coerce.boolean().default(true),
})
export type GopoQuery = z.infer<typeof gopoQuery>
