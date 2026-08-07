import { describe, expect, it } from 'vitest'
import { allocateOverhead, balancePending, grossProfit } from './profit'

describe('grossProfit', () => {
  it('revenue minus direct team cost minus project expenses', () => {
    expect(grossProfit({ revenue: 200000, directTeamCost: 40000, projectExpenses: 15000 })).toBe(145000)
  })
  it('can go negative', () => {
    expect(grossProfit({ revenue: 50000, directTeamCost: 40000, projectExpenses: 20000 })).toBe(-10000)
  })
})

describe('balancePending', () => {
  it('never negative', () => {
    expect(balancePending(100000, 60000)).toBe(40000)
    expect(balancePending(100000, 120000)).toBe(0)
  })
})

describe('allocateOverhead', () => {
  const projects = [
    { id: 'a', revenue: 300000, shootDays: 3 },
    { id: 'b', revenue: 100000, shootDays: 1 },
  ]

  it('equal splits the pool evenly', () => {
    expect(allocateOverhead(10000, projects, 'equal')).toEqual({ a: 5000, b: 5000 })
  })
  it('revenue_weighted splits by revenue share', () => {
    expect(allocateOverhead(10000, projects, 'revenue_weighted')).toEqual({ a: 7500, b: 2500 })
  })
  it('shoot_days_weighted splits by shoot-day share', () => {
    expect(allocateOverhead(10000, projects, 'shoot_days_weighted')).toEqual({ a: 7500, b: 2500 })
  })
  it('zero basis yields zero allocations', () => {
    const zero = [{ id: 'a', revenue: 0, shootDays: 0 }]
    expect(allocateOverhead(10000, zero, 'revenue_weighted')).toEqual({ a: 0 })
  })
  it('empty project set yields empty map', () => {
    expect(allocateOverhead(10000, [], 'equal')).toEqual({})
  })
})
