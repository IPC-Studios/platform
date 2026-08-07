import { roundINR, sumINR } from './money'

/**
 * A deliverable's price-affecting shape. Only the three flags + the amount
 * matter for totals; everything else is display/workflow.
 */
export interface DeliverableForTotal {
  visibility_scope: 'client' | 'internal'
  show_on_quotation: boolean
  is_additional_charge: boolean
  additional_charge_amount: number
}

/**
 * THE rule (from the modelling notes): a deliverable adds to the project's
 * additional cost ONLY when it is client-visible AND shown on the quotation
 * AND flagged as an additional charge. Internal deliverables never affect
 * price. This is the single source of truth the DB trigger mirrors and the
 * create-project wizard previews.
 */
export function qualifiesForCharge(d: DeliverableForTotal): boolean {
  return d.visibility_scope === 'client' && d.show_on_quotation && d.is_additional_charge
}

export interface ProjectTotals {
  additional_deliverables_cost: number
  total_cost: number
}

export function computeProjectTotals(
  packageCost: number,
  deliverables: ReadonlyArray<DeliverableForTotal>,
): ProjectTotals {
  const additional = sumINR(
    deliverables.filter(qualifiesForCharge).map((d) => d.additional_charge_amount),
  )
  return {
    additional_deliverables_cost: additional,
    total_cost: roundINR(packageCost + additional),
  }
}
