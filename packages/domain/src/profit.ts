import { roundINR, sumINR } from './money'

/**
 * Project profit (authoritative, from PROJECT_PROFIT_LOGIC_SEPARATION):
 *   Gross Profit = Revenue − Direct team cost − Project expenses
 * Revenue is the booked/contract value (projects.total_cost), NOT payment date.
 */
export interface ProfitInputs {
  revenue: number
  directTeamCost: number
  projectExpenses: number
}

export function grossProfit(i: ProfitInputs): number {
  return roundINR(i.revenue - i.directTeamCost - i.projectExpenses)
}

export function balancePending(revenue: number, received: number): number {
  return roundINR(Math.max(0, revenue - received))
}

export type AllocationMethod = 'equal' | 'revenue_weighted' | 'shoot_days_weighted'

export type MonthlyBasis = 'cash' | 'booked'

export interface MonthlyProfitCards {
  cashReceived: number
  bookedRevenue: number
  salaryCost: number
  officeFixed: number
  fixedTotal: number
  variableCost: number
  totalCost: number
  netCash: number
  netBooked: number
  marginCash: number | null
  marginBooked: number | null
}

/** Monthly profit cards from Lovable financials/profit (cash + booked side by side). */
export function monthlyProfitCards(input: {
  cashReceived: number
  bookedRevenue: number
  salaryCost: number
  officeFixed: number
  variableCost: number
}): MonthlyProfitCards {
  const fixedTotal = roundINR(input.salaryCost + input.officeFixed)
  const totalCost = roundINR(fixedTotal + input.variableCost)
  const netCash = roundINR(input.cashReceived - totalCost)
  const netBooked = roundINR(input.bookedRevenue - totalCost)
  return {
    cashReceived: input.cashReceived,
    bookedRevenue: input.bookedRevenue,
    salaryCost: input.salaryCost,
    officeFixed: input.officeFixed,
    fixedTotal,
    variableCost: input.variableCost,
    totalCost,
    netCash,
    netBooked,
    marginCash: input.cashReceived > 0 ? (netCash / input.cashReceived) * 100 : null,
    marginBooked: input.bookedRevenue > 0 ? (netBooked / input.bookedRevenue) * 100 : null,
  }
}

/** Monthly warnings: margin + salary-heavy signals (Lovable parity). */
export function monthlyProfitWarnings(cards: MonthlyProfitCards): string[] {
  const warnings: string[] = []
  const margin = cards.marginCash ?? cards.marginBooked
  if (margin != null && margin < 15) warnings.push('Net margin below 15% for this month.')
  const denom = cards.cashReceived > 0 ? cards.cashReceived : cards.bookedRevenue
  if (denom > 0 && cards.salaryCost > denom * 0.5) warnings.push('Salary cost exceeds 50% of revenue.')
  return warnings
}

export interface AllocationProject {
  id: string
  revenue: number
  shootDays: number
}

/**
 * Distribute a fixed-overhead pool across eligible projects.
 *   equal              = pool ÷ n
 *   revenue_weighted   = (project revenue ÷ Σ revenue) × pool
 *   shoot_days_weighted= (project shoot days ÷ Σ shoot days) × pool
 * Returns id → allocated amount. Empty input or a zero weight-basis yields 0s.
 */
export function allocateOverhead(
  pool: number,
  projects: ReadonlyArray<AllocationProject>,
  method: AllocationMethod,
): Record<string, number> {
  const out: Record<string, number> = {}
  const n = projects.length
  if (n === 0) return out

  if (method === 'equal') {
    const each = roundINR(pool / n)
    for (const p of projects) out[p.id] = each
    return out
  }

  const basis = method === 'revenue_weighted' ? (p: AllocationProject) => p.revenue : (p: AllocationProject) => p.shootDays
  const total = sumINR(projects.map(basis))
  for (const p of projects) {
    out[p.id] = total > 0 ? roundINR((basis(p) / total) * pool) : 0
  }
  return out
}
