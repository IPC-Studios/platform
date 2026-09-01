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

/**
 * When a deliverable is due, given the shoots it hangs off.
 *
 * A studio thinks in "album, 45 days after the wedding day" — not in calendar
 * dates. The rule picks the anchor shoot, adds the lead time, and the wizard
 * shows the result so nobody is typing dates that the schedule already implies:
 *
 *   this_shoot      → the one shoot it was pinned to
 *   specific_shoots → the LAST of the chosen shoots (everything must be shot
 *                     before the edit can start)
 *   whole_project   → the last shoot of the project, same reason
 *   no_data         → nothing to anchor to; the date stays whatever was typed
 *
 * Returns null when there is no anchor yet — an undated shoot, or no shoots at
 * all. Null means "unknown", never "today".
 */
export type DeliverableStartRule = 'this_shoot' | 'whole_project' | 'specific_shoots' | 'no_data'

export interface ShootDate {
  /** "YYYY-MM-DD", or null while the shoot is still unscheduled. */
  shoot_date: string | null
}

export function anchorShootDate(
  rule: DeliverableStartRule,
  shoots: ReadonlyArray<ShootDate>,
  pinnedIndex?: number,
): string | null {
  if (rule === 'no_data') return null
  if (rule === 'this_shoot') {
    const pinned = pinnedIndex === undefined ? undefined : shoots[pinnedIndex]
    return pinned?.shoot_date ?? null
  }
  const dated = shoots.map((s) => s.shoot_date).filter((d): d is string => !!d)
  if (dated.length === 0) return null
  // ISO dates sort lexicographically, so the max is the last shoot.
  return dated.reduce((latest, d) => (d > latest ? d : latest))
}

/** Add whole days to a "YYYY-MM-DD" date, staying in UTC to dodge DST drift. */
export function addDays(isoDate: string, days: number): string {
  const [y, m, d] = isoDate.split('-').map(Number)
  if (!y || !m || !d) return isoDate
  const at = new Date(Date.UTC(y, m - 1, d))
  at.setUTCDate(at.getUTCDate() + days)
  return at.toISOString().slice(0, 10)
}

/**
 * The estimated delivery date for one deliverable: its anchor shoot plus the
 * agreed lead time. Null when either half is unknown — a guessed delivery date
 * is worse than none, because the client is quoted from it.
 */
export function deliverableEstimatedDate(
  rule: DeliverableStartRule,
  shoots: ReadonlyArray<ShootDate>,
  leadDays: number | undefined,
  pinnedIndex?: number,
): string | null {
  const anchor = anchorShootDate(rule, shoots, pinnedIndex)
  if (anchor === null || leadDays === undefined) return null
  return addDays(anchor, leadDays)
}
