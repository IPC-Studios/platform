import { roundINR } from './money'

export interface GopoScoreInput {
  total_revenue: number
  total_received: number
  total_expenses: number
  total_direct_team_cost: number
}

export interface GopoScoreResult {
  health_score: number
  health_label: 'excellent' | 'good' | 'fair' | 'poor' | 'critical'
  net_profit: number
  collection_rate: number
  profit_margin: number
  outstanding_balance: number
}

export function computeGopoScore(input: GopoScoreInput): GopoScoreResult {
  const net_profit = roundINR(input.total_revenue - input.total_direct_team_cost - input.total_expenses)
  const collection_rate = input.total_revenue > 0
    ? roundINR((input.total_received / input.total_revenue) * 100)
    : 0
  const profit_margin = input.total_revenue > 0
    ? roundINR((net_profit / input.total_revenue) * 100)
    : 0
  const outstanding_balance = roundINR(Math.max(0, input.total_revenue - input.total_received))

  // Health score: weighted combination of collection rate and profit margin
  const raw_score = collection_rate * 0.5 + profit_margin * 0.5
  const health_score = Math.min(100, Math.max(0, roundINR(raw_score)))

  let health_label: GopoScoreResult['health_label']
  if (health_score >= 80) health_label = 'excellent'
  else if (health_score >= 60) health_label = 'good'
  else if (health_score >= 40) health_label = 'fair'
  else if (health_score >= 20) health_label = 'poor'
  else health_label = 'critical'

  return { health_score, health_label, net_profit, collection_rate, profit_margin, outstanding_balance }
}

export interface CategoryBreakdown {
  category: string
  amount: number
  percentage: number
  count: number
}

export function computeExpenseBreakdown(
  expenses: ReadonlyArray<{ category: string | null; amount: number }>,
): CategoryBreakdown[] {
  const total = expenses.reduce((s, e) => s + e.amount, 0)
  const byCategory = new Map<string, { amount: number; count: number }>()
  for (const e of expenses) {
    const cat = e.category ?? 'uncategorized'
    const existing = byCategory.get(cat) ?? { amount: 0, count: 0 }
    existing.amount += e.amount
    existing.count += 1
    byCategory.set(cat, existing)
  }
  return Array.from(byCategory.entries())
    .map(([category, { amount, count }]) => ({
      category,
      amount: roundINR(amount),
      percentage: total > 0 ? roundINR((amount / total) * 100) : 0,
      count,
    }))
    .sort((a, b) => b.amount - a.amount)
}

export function classifyAttentionItem(
  kind: 'overdue_payment' | 'high_expense' | 'low_margin' | 'no_payment' | 'negative_profit',
  amount: number | null,
): 'info' | 'warning' | 'critical' {
  switch (kind) {
    case 'negative_profit':
      return 'critical'
    case 'no_payment':
      return amount !== null && amount > 100000 ? 'critical' : 'warning'
    case 'overdue_payment':
      return amount !== null && amount > 50000 ? 'critical' : 'warning'
    case 'high_expense':
      return 'warning'
    case 'low_margin':
      return 'info'
  }
}
