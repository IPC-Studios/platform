import { describe, expect, it } from 'vitest'
import { computeGst } from './gst'
import { applyDiscount, roundINR } from './money'

describe('computeGst — place-of-supply split', () => {
  it('intra-state splits 18% into equal CGST + SGST', () => {
    const b = computeGst(1000, 18, { intraState: true })
    expect(b.cgst).toBe(90)
    expect(b.sgst).toBe(90)
    expect(b.igst).toBe(0)
    expect(b.tax).toBe(180)
    expect(b.total).toBe(1180)
  })

  it('inter-state charges a single IGST at the full rate', () => {
    const b = computeGst(1000, 18, { intraState: false })
    expect(b.cgst).toBe(0)
    expect(b.sgst).toBe(0)
    expect(b.igst).toBe(180)
    expect(b.total).toBe(1180)
  })

  it('zero-rated supply adds no tax', () => {
    const b = computeGst(1000, 0, { intraState: true })
    expect(b.tax).toBe(0)
    expect(b.total).toBe(1000)
  })

  it('rounds each component to the paisa (odd base, 5%)', () => {
    const b = computeGst(999.99, 5, { intraState: true })
    // 999.99 * 5 / 200 = 24.99975 -> 25.00 each
    expect(b.cgst).toBe(25)
    expect(b.sgst).toBe(25)
    expect(b.total).toBe(1049.99)
  })
})

describe('money helpers', () => {
  it('roundINR is half-up at the paisa', () => {
    expect(roundINR(1.005)).toBe(1.01)
    expect(roundINR(2.674)).toBe(2.67)
  })

  it('applyDiscount handles percent and flat, never below zero', () => {
    expect(applyDiscount(1000, { kind: 'percent', value: 10 })).toBe(900)
    expect(applyDiscount(1000, { kind: 'flat', value: 250 })).toBe(750)
    expect(applyDiscount(100, { kind: 'flat', value: 500 })).toBe(0)
  })
})
