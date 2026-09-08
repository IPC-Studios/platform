import { roundINR } from './money'

export interface GstComputationInput {
  taxable_amount: number
  gst_rate: number
  intra_state: boolean
}

export interface GstComputationResult {
  cgst: number
  sgst: number
  igst: number
  total_tax: number
}

export function computeGstAnalysis(input: GstComputationInput): GstComputationResult {
  const tax = roundINR((input.taxable_amount * input.gst_rate) / 100)
  if (input.intra_state) {
    const half = roundINR(tax / 2)
    return { cgst: half, sgst: half, igst: 0, total_tax: tax }
  }
  return { cgst: 0, sgst: 0, igst: tax, total_tax: tax }
}

export interface GstSummaryInput {
  total_income: number
  total_expenses: number
  gst_collected: number
  gst_paid: number
  reverse_charge: number
}

export function computeNetGst(input: GstSummaryInput): number {
  const liability = input.gst_collected - input.gst_paid - input.reverse_charge
  return roundINR(Math.max(0, liability))
}

export function computeInputTaxCredit(
  expenses: ReadonlyArray<{ gst_treatment: string; amount: number; gst_rate?: number }>,
): number {
  return roundINR(
    expenses
      .filter((e) => e.gst_treatment === 'gst_applicable' && e.gst_rate && e.gst_rate > 0)
      .reduce((sum, e) => sum + (e.amount * (e.gst_rate ?? 0)) / 100, 0),
  )
}
