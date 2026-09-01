import {
  computeProjectTotals,
  deliverableEstimatedDate,
  type DeliverableForTotal,
} from '@ipc/domain'
import type { CreateProjectRequest, CreateShootRequest, DeliverableInput } from '@ipc/contracts'

/**
 * Create Project, as data.
 *
 * A studio sets up a project once and then lives with it for a year, so the
 * flow asks for the whole picture — client, shoots, deliverables, money — one
 * section at a time, and keeps a draft so a phone call in the middle doesn't
 * cost them the work.
 *
 * Everything here is pure: the route renders it, the tests exercise it, and
 * nothing reaches the network until Review.
 */
export const WIZARD_STEPS = ['client', 'shoots', 'deliverables', 'billing', 'review'] as const
export type WizardStep = (typeof WIZARD_STEPS)[number]

export const STEP_LABELS: Record<WizardStep, string> = {
  client: 'Project & Client',
  shoots: 'Shoots',
  deliverables: 'Deliverables',
  billing: 'Billing',
  review: 'Review',
}

export const STEP_HINTS: Record<WizardStep, string> = {
  client: 'Name the project and say who it is for.',
  shoots: 'The days you are shooting. Deliverable dates follow these.',
  deliverables: 'What the client receives, and what costs extra.',
  billing: 'The package price and anything already paid.',
  review: 'Check it over, then create.',
}

export interface ShootDraft {
  name: string
  shoot_date: string
  location: string
  status: 'planned' | 'confirmed'
}

export interface DeliverableDraft {
  title: string
  is_additional_charge: boolean
  additional_charge_amount: string
  visibility_scope: 'client' | 'internal'
  show_on_quotation: boolean
  start_rule: 'this_shoot' | 'whole_project' | 'specific_shoots' | 'no_data'
  /** Which shoot it hangs off, for `this_shoot`. Index into the draft's shoots. */
  shoot_index: number | null
  /** Lead time in days; blank means "no schedule yet". */
  lead_days: string
}

export interface PaymentDraft {
  amount: string
  paid_on: string
  mode: string
  reference: string
}

export interface ProjectDraft {
  name: string
  show_quotation: boolean
  /** Existing client id, or '' when adding a new one. */
  client_id: string
  new_client_name: string
  new_client_phone: string
  package_cost: string
  shoots: ShootDraft[]
  deliverables: DeliverableDraft[]
  payments: PaymentDraft[]
}

export const EMPTY_DRAFT: ProjectDraft = {
  name: '',
  show_quotation: true,
  client_id: '',
  new_client_name: '',
  new_client_phone: '',
  package_cost: '',
  shoots: [],
  deliverables: [],
  payments: [],
}

export const newShoot = (): ShootDraft => ({
  name: '',
  shoot_date: '',
  location: '',
  status: 'planned',
})

export const newDeliverable = (): DeliverableDraft => ({
  title: '',
  is_additional_charge: false,
  additional_charge_amount: '',
  visibility_scope: 'client',
  show_on_quotation: true,
  start_rule: 'whole_project',
  shoot_index: null,
  lead_days: '',
})

export const newPayment = (): PaymentDraft => ({ amount: '', paid_on: '', mode: '', reference: '' })

/** '' → 0, so a blank money field never becomes NaN in a total. */
export const money = (v: string): number => {
  const n = Number(v)
  return v.trim() === '' || Number.isNaN(n) ? 0 : n
}

const days = (v: string): number | undefined => {
  const n = Number(v)
  return v.trim() === '' || Number.isNaN(n) ? undefined : Math.max(0, Math.trunc(n))
}

/** The date a deliverable lands on, given the draft's shoots. Null = unknown. */
export function estimatedDateFor(draft: ProjectDraft, d: DeliverableDraft): string | null {
  return deliverableEstimatedDate(
    d.start_rule,
    draft.shoots.map((s) => ({ shoot_date: s.shoot_date || null })),
    days(d.lead_days),
    d.shoot_index ?? undefined,
  )
}

const forTotal = (d: DeliverableDraft): DeliverableForTotal => ({
  visibility_scope: d.visibility_scope,
  show_on_quotation: d.show_on_quotation,
  is_additional_charge: d.is_additional_charge,
  additional_charge_amount: money(d.additional_charge_amount),
})

export interface DraftTotals {
  packageCost: number
  addOns: number
  total: number
  received: number
  balance: number
}

/**
 * The running total, shown on every step. Add-ons follow the domain rule (only
 * client-visible, quoted, chargeable deliverables count), so the footer can
 * never disagree with what the server computes after save.
 */
export function draftTotals(draft: ProjectDraft): DraftTotals {
  const packageCost = money(draft.package_cost)
  const { additional_deliverables_cost, total_cost } = computeProjectTotals(
    packageCost,
    draft.deliverables.map(forTotal),
  )
  const received = draft.payments.reduce((sum, p) => sum + money(p.amount), 0)
  return {
    packageCost,
    addOns: additional_deliverables_cost,
    total: total_cost,
    received,
    balance: Math.max(0, total_cost - received),
  }
}

export type StepErrors = Partial<Record<WizardStep, string>>

/**
 * What still blocks each step. Only the client step is ever truly required —
 * a studio that just wants the project on the board should not have to invent
 * shoots or line items to get past step 2.
 */
export function stepErrors(draft: ProjectDraft): StepErrors {
  const errors: StepErrors = {}

  if (!draft.name.trim()) errors.client = 'Give the project a name.'
  else if (!draft.client_id && !draft.new_client_name.trim()) errors.client = 'Pick or add a client.'

  if (draft.shoots.some((s) => !s.name.trim())) errors.shoots = 'Every shoot needs a name.'

  if (draft.deliverables.some((d) => !d.title.trim())) {
    errors.deliverables = 'Every deliverable needs a title.'
  } else if (
    draft.deliverables.some((d) => d.is_additional_charge && money(d.additional_charge_amount) <= 0)
  ) {
    errors.deliverables = 'A chargeable deliverable needs an amount.'
  }

  const totals = draftTotals(draft)
  if (draft.payments.some((p) => money(p.amount) <= 0)) errors.billing = 'Every payment needs an amount.'
  else if (totals.received > totals.total && totals.total > 0) {
    errors.billing = 'Payments received exceed the project total.'
  }

  return errors
}

export const canLeave = (step: WizardStep, draft: ProjectDraft): boolean => !stepErrors(draft)[step]

/** Ready to create: every step clean, not just the one on screen. */
export const canSubmit = (draft: ProjectDraft): boolean =>
  Object.keys(stepErrors(draft)).length === 0

export const stepIndex = (step: WizardStep): number => WIZARD_STEPS.indexOf(step)

export function nextStep(step: WizardStep): WizardStep {
  return WIZARD_STEPS[Math.min(stepIndex(step) + 1, WIZARD_STEPS.length - 1)]!
}

export function prevStep(step: WizardStep): WizardStep {
  return WIZARD_STEPS[Math.max(stepIndex(step) - 1, 0)]!
}

/** Draft → the create payload. Blank rows are dropped, not sent as empties. */
export function toProjectRequest(draft: ProjectDraft, clientId: string): CreateProjectRequest {
  const deliverables: DeliverableInput[] = draft.deliverables
    .filter((d) => d.title.trim())
    .map((d) => {
      const estimated = estimatedDateFor(draft, d)
      const lead = days(d.lead_days)
      return {
        title: d.title.trim(),
        list_key: 'primary',
        is_additional_charge: d.is_additional_charge,
        additional_charge_amount: d.is_additional_charge ? money(d.additional_charge_amount) : 0,
        visibility_scope: d.visibility_scope,
        show_on_quotation: d.show_on_quotation,
        start_rule: d.start_rule,
        ...(lead !== undefined ? { delivery_days_after_start: lead } : {}),
        ...(estimated ? { estimated_date: estimated } : {}),
      }
    })

  return {
    client_id: clientId,
    name: draft.name.trim(),
    package_cost: money(draft.package_cost),
    status: 'active',
    show_quotation: draft.show_quotation,
    deliverables,
    payments: draft.payments
      .filter((p) => money(p.amount) > 0)
      .map((p) => ({
        amount: money(p.amount),
        ...(p.paid_on ? { paid_on: p.paid_on } : {}),
        ...(p.mode.trim() ? { mode: p.mode.trim() } : {}),
        ...(p.reference.trim() ? { reference: p.reference.trim() } : {}),
      })),
  }
}

/** Shoots are created after the project, so they need its id. */
export function toShootRequests(draft: ProjectDraft, projectId: string): CreateShootRequest[] {
  return draft.shoots
    .filter((s) => s.name.trim())
    .map((s) => ({
      project_id: projectId,
      name: s.name.trim(),
      status: s.status,
      ...(s.shoot_date ? { shoot_date: s.shoot_date } : {}),
      ...(s.location.trim() ? { location: s.location.trim() } : {}),
    }))
}

/** A draft worth restoring — anything typed beyond the defaults. */
export function isDirty(draft: ProjectDraft): boolean {
  return (
    draft.name.trim() !== '' ||
    draft.client_id !== '' ||
    draft.new_client_name.trim() !== '' ||
    draft.package_cost.trim() !== '' ||
    draft.shoots.length > 0 ||
    draft.deliverables.length > 0 ||
    draft.payments.length > 0
  )
}

export const DRAFT_KEY = 'ipc.project.draft'

interface StoredDraft {
  draft: ProjectDraft
  savedAt: string
}

/**
 * Drafts live in this browser only. A half-typed project is not something to
 * sync across devices — it is a safety net for the tab you are in.
 */
export function saveDraft(draft: ProjectDraft, now: string): void {
  try {
    if (!isDirty(draft)) {
      localStorage.removeItem(DRAFT_KEY)
      return
    }
    localStorage.setItem(DRAFT_KEY, JSON.stringify({ draft, savedAt: now } satisfies StoredDraft))
  } catch {
    // A full or blocked localStorage must never take the form down with it.
  }
}

export function loadDraft(): StoredDraft | null {
  try {
    const raw = localStorage.getItem(DRAFT_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<StoredDraft>
    if (!parsed?.draft || typeof parsed.savedAt !== 'string') return null
    // Merge over the defaults: a draft written before a field existed must not
    // come back missing that field.
    return { draft: { ...EMPTY_DRAFT, ...parsed.draft }, savedAt: parsed.savedAt }
  } catch {
    return null
  }
}

export function clearDraft(): void {
  try {
    localStorage.removeItem(DRAFT_KEY)
  } catch {
    // Nothing to do — the draft simply outlives this attempt.
  }
}
