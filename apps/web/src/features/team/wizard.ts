import { addMemberRequest, type AddMemberRequest } from '@ipc/contracts'
import { fieldErrors, type FieldErrors } from '@/shared/forms/field-errors'

/**
 * The Add Team Member wizard, as data.
 *
 * Six short questions instead of one long form: the answers change what comes
 * next (a freelancer isn't asked for a salary; someone with no login isn't
 * asked for a password), and asking them one at a time is what makes that
 * legible. Every rule here is checked again by `addMemberRequest` on the way
 * out and by the API on the way in — this only decides when to show the
 * message.
 */
export const WIZARD_STEPS = ['engagement', 'login', 'contact', 'role', 'details', 'review'] as const
export type WizardStep = (typeof WIZARD_STEPS)[number]

export const STEP_LABELS: Record<WizardStep, string> = {
  engagement: 'Engagement',
  login: 'Login',
  contact: 'Contact',
  role: 'Role',
  details: 'Details',
  review: 'Review',
}

export interface MemberDraft {
  engagement_type: 'in_house' | 'freelancer'
  create_login: boolean
  name: string
  phone: string
  email: string
  alternate_phone: string
  password: string
  confirm_password: string
  role: 'admin' | 'manager' | 'employee'
  role_ids: string[]
  salary: string
  address: string
}

export const EMPTY_DRAFT: MemberDraft = {
  engagement_type: 'in_house',
  create_login: true,
  name: '',
  phone: '',
  email: '',
  alternate_phone: '',
  password: '',
  confirm_password: '',
  role: 'employee',
  role_ids: [],
  salary: '',
  address: '',
}

type DraftField = keyof MemberDraft

const LABELS: Record<string, string> = {
  engagement_type: 'Engagement',
  create_login: 'Login',
  name: 'Name',
  phone: 'Phone',
  email: 'Email',
  alternate_phone: 'Alternate phone',
  password: 'Password',
  confirm_password: 'Confirm password',
  role: 'Role',
  role_ids: 'Job roles',
  salary: 'Salary',
  address: 'Address',
}

/** Which answers a step is responsible for — used to scope its messages. */
const STEP_FIELDS: Record<WizardStep, readonly DraftField[]> = {
  engagement: ['engagement_type'],
  login: ['create_login'],
  contact: ['name', 'phone', 'email', 'password', 'confirm_password'],
  role: ['role', 'role_ids'],
  details: ['salary', 'address'],
  review: [
    'name',
    'phone',
    'email',
    'password',
    'confirm_password',
    'role',
    'salary',
    'address',
  ],
}

/** Draft (all strings, as typed) → the shape the contract expects. */
export function toPayload(d: MemberDraft): Record<string, unknown> {
  const salary = d.salary.trim() === '' ? undefined : Number(d.salary)
  return {
    engagement_type: d.engagement_type,
    create_login: d.create_login,
    name: d.name.trim(),
    phone: d.phone.trim(),
    role: d.role,
    role_ids: d.role_ids,
    ...(d.email.trim() ? { email: d.email.trim() } : {}),
    ...(d.alternate_phone.trim() ? { alternate_phone: d.alternate_phone.trim() } : {}),
    ...(d.create_login && d.password ? { password: d.password } : {}),
    ...(salary !== undefined ? { salary } : {}),
    ...(d.address.trim() ? { address: d.address.trim() } : {}),
  }
}

/**
 * Messages for the step in front of the user, and only that step — the contract
 * validates the whole payload at once, so an early step would otherwise light
 * up over answers that haven't been asked for yet.
 */
export function stepErrors(step: WizardStep, draft: MemberDraft): FieldErrors<DraftField> {
  const all = fieldErrors<DraftField>(addMemberRequest, toPayload(draft), { labels: LABELS })
  const out: FieldErrors<DraftField> = {}
  for (const field of STEP_FIELDS[step]) {
    if (all[field]) out[field] = all[field]
  }
  // Confirmation isn't part of the payload — it exists to catch a typo before
  // the owner reads the password out to someone.
  if (STEP_FIELDS[step].includes('confirm_password') && draft.create_login) {
    if (draft.password && draft.password !== draft.confirm_password) {
      out.confirm_password = 'Passwords do not match.'
    }
  }
  if (STEP_FIELDS[step].includes('salary') && draft.salary.trim() !== '') {
    const n = Number(draft.salary)
    if (Number.isNaN(n) || n < 0) out.salary = 'Salary must be a number.'
  }
  return out
}

export const isStepValid = (step: WizardStep, draft: MemberDraft): boolean =>
  Object.keys(stepErrors(step, draft)).length === 0

/** Final parse. Throws if the draft is incomplete — the Review step gates it. */
export const toRequest = (draft: MemberDraft): AddMemberRequest =>
  addMemberRequest.parse(toPayload(draft))

export const stepIndex = (step: WizardStep): number => WIZARD_STEPS.indexOf(step)

export function nextStep(step: WizardStep): WizardStep {
  const i = stepIndex(step)
  return WIZARD_STEPS[Math.min(i + 1, WIZARD_STEPS.length - 1)]!
}

export function prevStep(step: WizardStep): WizardStep {
  const i = stepIndex(step)
  return WIZARD_STEPS[Math.max(i - 1, 0)]!
}
