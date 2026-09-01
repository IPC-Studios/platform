import { describe, expect, it } from 'vitest'
import {
  addDays,
  anchorShootDate,
  computeProjectTotals,
  deliverableEstimatedDate,
  qualifiesForCharge,
  type DeliverableForTotal,
} from './projects'

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

const shoot = (shoot_date: string | null) => ({ shoot_date })

describe('anchorShootDate', () => {
  const shoots = [shoot('2026-11-20'), shoot('2026-11-22'), shoot('2026-11-18')]

  it('anchors a whole-project deliverable to the LAST shoot', () => {
    // Editing cannot start until everything is shot, so the latest date wins —
    // not the first, and not the order they were typed in.
    expect(anchorShootDate('whole_project', shoots)).toBe('2026-11-22')
    expect(anchorShootDate('specific_shoots', shoots)).toBe('2026-11-22')
  })

  it('anchors a pinned deliverable to its own shoot', () => {
    expect(anchorShootDate('this_shoot', shoots, 0)).toBe('2026-11-20')
    expect(anchorShootDate('this_shoot', shoots, 2)).toBe('2026-11-18')
  })

  it('has no anchor when the shoot it points at is gone or undated', () => {
    expect(anchorShootDate('this_shoot', shoots, 9)).toBeNull()
    expect(anchorShootDate('this_shoot', shoots)).toBeNull()
    expect(anchorShootDate('this_shoot', [shoot(null)], 0)).toBeNull()
  })

  it('ignores undated shoots rather than treating them as today', () => {
    expect(anchorShootDate('whole_project', [shoot(null), shoot('2026-01-05')])).toBe('2026-01-05')
    expect(anchorShootDate('whole_project', [shoot(null)])).toBeNull()
    expect(anchorShootDate('whole_project', [])).toBeNull()
  })

  it('never anchors a no_data deliverable', () => {
    expect(anchorShootDate('no_data', shoots, 0)).toBeNull()
  })
})

describe('addDays', () => {
  it('crosses months and years', () => {
    expect(addDays('2026-11-22', 45)).toBe('2027-01-06')
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01')
    expect(addDays('2026-01-31', 1)).toBe('2026-02-01')
  })

  it('handles a leap day and a zero-day lead', () => {
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29')
    expect(addDays('2026-06-01', 0)).toBe('2026-06-01')
  })

  it('leaves an unparseable date alone', () => {
    expect(addDays('not-a-date', 5)).toBe('not-a-date')
  })
})

describe('deliverableEstimatedDate', () => {
  const shoots = [shoot('2026-11-20'), shoot('2026-11-22')]

  it('is the anchor plus the lead time', () => {
    expect(deliverableEstimatedDate('whole_project', shoots, 45)).toBe('2027-01-06')
    expect(deliverableEstimatedDate('this_shoot', shoots, 7, 0)).toBe('2026-11-27')
  })

  it('stays unknown when either half is missing', () => {
    // A guessed delivery date is worse than none — the client is quoted from it.
    expect(deliverableEstimatedDate('whole_project', shoots, undefined)).toBeNull()
    expect(deliverableEstimatedDate('whole_project', [], 45)).toBeNull()
    expect(deliverableEstimatedDate('no_data', shoots, 45)).toBeNull()
  })
})
