import { describe, expect, it } from 'vitest'
import { computeInvoice } from './invoice'
import { amountInWords } from './amount-in-words'

describe('computeInvoice', () => {
  const lines = [
    { description: 'Photography', quantity: 1, rate: 100000, gst_rate: 18 as const },
    { description: 'Album', quantity: 2, rate: 10000, gst_rate: 12 as const },
  ]

  it('intra-state splits CGST/SGST, no discount', () => {
    const inv = computeInvoice(lines, { intraState: true })
    expect(inv.subtotal).toBe(120000)
    // 100000@18 -> 18000 (9+9k); 20000@12 -> 2400 (1.2+1.2k)
    expect(inv.tax).toBe(20400)
    expect(inv.total).toBe(140400)
    expect(inv.lines[0]!.cgst).toBe(9000)
    expect(inv.lines[0]!.sgst).toBe(9000)
    expect(inv.lines[0]!.igst).toBe(0)
  })

  it('inter-state uses IGST', () => {
    const inv = computeInvoice(lines, { intraState: false })
    expect(inv.lines[0]!.igst).toBe(18000)
    expect(inv.lines[0]!.cgst).toBe(0)
    expect(inv.total).toBe(140400)
  })

  it('applies discount proportionally before tax', () => {
    const inv = computeInvoice(lines, { intraState: true, discount: 12000 }) // 10% off
    expect(inv.discount).toBe(12000)
    expect(inv.taxable).toBe(108000) // 120000 - 12000
    // tax scales by 0.9 -> 18360
    expect(inv.tax).toBe(18360)
    expect(inv.total).toBe(126360)
  })

  it('caps discount at subtotal', () => {
    const inv = computeInvoice(lines, { intraState: true, discount: 999999 })
    expect(inv.discount).toBe(120000)
    expect(inv.taxable).toBe(0)
    expect(inv.total).toBe(0)
  })
})

describe('amountInWords (Indian)', () => {
  it('formats lakhs and crores', () => {
    expect(amountInWords(123456)).toBe(
      'One Lakh Twenty Three Thousand Four Hundred Fifty Six Rupees',
    )
    expect(amountInWords(10000000)).toBe('One Crore Rupees')
    expect(amountInWords(0)).toBe('Zero Rupees')
    expect(amountInWords(140400)).toBe('One Lakh Forty Thousand Four Hundred Rupees')
  })
})
