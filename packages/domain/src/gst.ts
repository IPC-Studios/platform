import { roundINR } from './money'

/**
 * GST engine. The split is decided by PLACE OF SUPPLY:
 *   - intra-state (supplier state === place of supply): CGST + SGST, half the
 *     rate each.
 *   - inter-state: a single IGST at the full rate.
 * The caller decides `intraState` by comparing state codes — this stays pure.
 */
export type GstSlab = 0 | 5 | 12 | 18 | 28

export interface GstBreakdown {
  taxable: number
  rate: GstSlab
  cgst: number
  sgst: number
  igst: number
  /** cgst + sgst + igst */
  tax: number
  /** taxable + tax */
  total: number
}

export function computeGst(
  taxable: number,
  rate: GstSlab,
  opts: { intraState: boolean },
): GstBreakdown {
  const base = roundINR(taxable)
  let cgst = 0
  let sgst = 0
  let igst = 0

  if (rate > 0) {
    if (opts.intraState) {
      const half = roundINR((base * rate) / 200)
      cgst = half
      sgst = half
    } else {
      igst = roundINR((base * rate) / 100)
    }
  }

  const tax = roundINR(cgst + sgst + igst)
  return { taxable: base, rate, cgst, sgst, igst, tax, total: roundINR(base + tax) }
}
