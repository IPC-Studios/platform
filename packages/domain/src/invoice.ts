import { computeGst, type GstSlab } from './gst'
import { roundINR, sumINR } from './money'

export interface InvoiceLineInput {
  description: string
  quantity: number
  rate: number
  gst_rate: GstSlab
}

export interface InvoiceLine extends InvoiceLineInput {
  amount: number // quantity * rate
  taxable: number // amount after proportional discount
  cgst: number
  sgst: number
  igst: number
}

export interface InvoiceTotals {
  lines: InvoiceLine[]
  subtotal: number
  discount: number
  taxable: number
  tax: number
  total: number
}

/**
 * Compute an invoice from its lines. Discount (flat ₹) is applied proportionally
 * across lines, then GST is charged on each line's discounted taxable value
 * using the place-of-supply split. This is the single source the API persists.
 */
export function computeInvoice(
  lines: ReadonlyArray<InvoiceLineInput>,
  opts: { intraState: boolean; discount?: number },
): InvoiceTotals {
  const amounts = lines.map((l) => roundINR(l.quantity * l.rate))
  const subtotal = sumINR(amounts)
  const discount = Math.min(Math.max(0, opts.discount ?? 0), subtotal)
  const ratio = subtotal > 0 ? (subtotal - discount) / subtotal : 1

  const computed: InvoiceLine[] = lines.map((l, i) => {
    const amount = amounts[i] ?? 0
    const taxable = roundINR(amount * ratio)
    const g = computeGst(taxable, l.gst_rate, { intraState: opts.intraState })
    return { ...l, amount, taxable, cgst: g.cgst, sgst: g.sgst, igst: g.igst }
  })

  const taxable = sumINR(computed.map((l) => l.taxable))
  const tax = sumINR(computed.map((l) => l.cgst + l.sgst + l.igst))
  return { lines: computed, subtotal, discount, taxable, tax, total: roundINR(taxable + tax) }
}
