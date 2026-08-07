import { describe, expect, it } from 'vitest'
import { computeProjectTotals, qualifiesForCharge, type DeliverableForTotal } from './projects'

const d = (over: Partial<DeliverableForTotal> = {}): DeliverableForTotal => ({
  visibility_scope: 'client',
  show_on_quotation: true,
  is_additional_charge: true,
  additional_charge_amount: 1000,
  ...over,
})

describe('qualifiesForCharge — all three flags required', () => {
  it('qualifies when client-visible + on quotation + additional charge', () => {
    expect(qualifiesForCharge(d())).toBe(true)
  })
  it('internal deliverables never qualify', () => {
    expect(qualifiesForCharge(d({ visibility_scope: 'internal' }))).toBe(false)
  })
  it('off-quotation never qualifies', () => {
    expect(qualifiesForCharge(d({ show_on_quotation: false }))).toBe(false)
  })
  it('non-charge deliverables never qualify', () => {
    expect(qualifiesForCharge(d({ is_additional_charge: false }))).toBe(false)
  })
})

describe('computeProjectTotals', () => {
  it('total = package with no qualifying deliverables', () => {
    const t = computeProjectTotals(50000, [d({ is_additional_charge: false })])
    expect(t.additional_deliverables_cost).toBe(0)
    expect(t.total_cost).toBe(50000)
  })

  it('sums only qualifying deliverables into additional + total', () => {
    const t = computeProjectTotals(50000, [
      d({ additional_charge_amount: 5000 }), // qualifies
      d({ additional_charge_amount: 3000 }), // qualifies
      d({ visibility_scope: 'internal', additional_charge_amount: 9999 }), // no
      d({ show_on_quotation: false, additional_charge_amount: 9999 }), // no
      d({ is_additional_charge: false, additional_charge_amount: 9999 }), // no
    ])
    expect(t.additional_deliverables_cost).toBe(8000)
    expect(t.total_cost).toBe(58000)
  })

  it('rounds to the paisa', () => {
    const t = computeProjectTotals(0, [
      d({ additional_charge_amount: 33.333 }),
      d({ additional_charge_amount: 33.333 }),
    ])
    expect(t.total_cost).toBe(66.67)
  })
})
