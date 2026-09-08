import { roundINR } from './money'

export interface PersonalExpenseSummaryInput {
  total_count: number
  total_amount: number
  this_month_amount: number
  this_month_count: number
}

export function computePersonalExpenseSummary(
  input: PersonalExpenseSummaryInput,
): PersonalExpenseSummaryInput {
  return {
    total_count: input.total_count,
    total_amount: roundINR(input.total_amount),
    this_month_amount: roundINR(input.this_month_amount),
    this_month_count: input.this_month_count,
  }
}

export interface PersonalCategoryBreakdown {
  category: string | null
  amount: number
  count: number
}

export function sortCategoryBreakdown(items: PersonalCategoryBreakdown[]): PersonalCategoryBreakdown[] {
  return [...items].sort((a, b) => b.amount - a.amount)
}

export interface DailyBreakdown {
  date: string
  amount: number
  count: number
}

export function fillMissingDays(
  days: DailyBreakdown[],
  start: string,
  end: string,
): DailyBreakdown[] {
  const map = new Map(days.map((d) => [d.date, d]))
  const result: DailyBreakdown[] = []
  const current = new Date(start)
  const last = new Date(end)
  while (current <= last) {
    const key = current.toISOString().slice(0, 10)
    result.push(map.get(key) ?? { date: key, amount: 0, count: 0 })
    current.setDate(current.getDate() + 1)
  }
  return result
}
