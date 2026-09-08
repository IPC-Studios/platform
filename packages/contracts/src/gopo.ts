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
})
export type GopoSummary = z.infer<typeof gopoSummary>
