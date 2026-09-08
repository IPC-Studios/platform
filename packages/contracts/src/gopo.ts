import { z } from 'zod'
import { uuid, isoDate, isoDateTime, money } from './shared/primitives'

export const gopoScoreCard = z.object({
  health_score: z.number().min(0).max(100),
  health_label: z.enum(['excellent', 'good', 'fair', 'poor', 'critical']),
  total_revenue: money,
  total_received: money,
  total_expenses: money,
  total_direct_team_cost: money,
  net_profit: money,
  collection_rate: z.number().min(0).max(100),
  profit_margin: z.number().min(0).max(100),
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
  gross_profit: money,
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
  amount: money.nullable(),
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
