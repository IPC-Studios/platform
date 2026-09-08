import { roundINR } from './money'

export interface PayoutCalculationInput {
  base_salary: number
  days_present: number
  total_working_days: number
  overtime_hours: number
  overtime_rate: number
  deductions: number
}

export function calculatePayout(input: PayoutCalculationInput): {
  base_proportion: number
  overtime_amount: number
  total_earnings: number
  net_payout: number
} {
  const base_proportion = input.total_working_days > 0
    ? roundINR((input.base_salary * input.days_present) / input.total_working_days)
    : 0
  const overtime_amount = roundINR(input.overtime_hours * input.overtime_rate)
  const total_earnings = roundINR(base_proportion + overtime_amount)
  const net_payout = roundINR(Math.max(0, total_earnings - input.deductions))

  return { base_proportion, overtime_amount, total_earnings, net_payout }
}

export function formatPayoutPeriod(start: string, end: string): string {
  const startDate = new Date(start)
  const endDate = new Date(end)
  const startMonth = startDate.toLocaleString('default', { month: 'short' })
  const endMonth = endDate.toLocaleString('default', { month: 'short' })
  const year = startDate.getFullYear()

  if (startMonth === endMonth) {
    return `${startMonth} ${year}`
  }
  return `${startMonth} - ${endMonth} ${year}`
}
