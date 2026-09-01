import { describe, expect, it } from 'vitest'
import {
  EMPTY_DRAFT,
  WIZARD_STEPS,
  isStepValid,
  nextStep,
  prevStep,
  stepErrors,
  toPayload,
  toRequest,
  type MemberDraft,
} from './wizard'

const draft = (over: Partial<MemberDraft> = {}): MemberDraft => ({ ...EMPTY_DRAFT, ...over })

const filled = draft({
  name: 'Meera Iyer',
  phone: '9876543210',
  email: 'meera@crew.in',
  password: 'secret123',
  confirm_password: 'secret123',
})

describe('wizard steps', () => {
  it('the first two steps always pass — both have a default answer', () => {
    expect(isStepValid('engagement', EMPTY_DRAFT)).toBe(true)
    expect(isStepValid('login', EMPTY_DRAFT)).toBe(true)
  })

  it('an early step never reports on answers it has not asked for', () => {
    // The contract fails on the empty name here; the engagement step must not
    // show that, or step 1 opens with an error about step 3.
    expect(stepErrors('engagement', EMPTY_DRAFT)).toEqual({})
  })

  it('contact requires name and phone, and email + password only with a login', () => {
    const errors = stepErrors('contact', EMPTY_DRAFT)
    expect(errors.name).toBeTruthy()
    expect(errors.phone).toBeTruthy()
    expect(errors.email).toBeTruthy()
    expect(errors.password).toBeTruthy()

    const offline = stepErrors('contact', draft({ create_login: false, name: 'Imran', phone: '9844444444' }))
    expect(offline).toEqual({})
  })

  it('catches a mistyped confirmation before the password is handed over', () => {
    const errors = stepErrors('contact', draft({ ...filled, confirm_password: 'secret124' }))
    expect(errors.confirm_password).toBe('Passwords do not match.')
    expect(isStepValid('contact', filled)).toBe(true)
  })

  it('rejects a salary that is not a number', () => {
    expect(stepErrors('details', draft({ salary: 'twelve' })).salary).toBeTruthy()
    expect(stepErrors('details', draft({ salary: '45000' }))).toEqual({})
    expect(stepErrors('details', draft({ salary: '' }))).toEqual({})
  })

  it('review answers for the whole draft', () => {
    expect(isStepValid('review', EMPTY_DRAFT)).toBe(false)
    expect(isStepValid('review', filled)).toBe(true)
  })

  it('walks forward and back without falling off either end', () => {
    expect(prevStep('engagement')).toBe('engagement')
    expect(nextStep('review')).toBe('review')
    expect(WIZARD_STEPS.reduce<string>((s) => nextStep(s as never), 'engagement')).toBe('review')
  })
})

describe('toPayload', () => {
  it('drops blanks rather than sending empty strings', () => {
    const payload = toPayload(draft({ name: ' Meera ', phone: ' 9876543210 ', create_login: false }))
    expect(payload).toEqual({
      engagement_type: 'in_house',
      create_login: false,
      name: 'Meera',
      phone: '9876543210',
      role: 'employee',
      role_ids: [],
    })
  })

  it('omits the password when no login was asked for', () => {
    const payload = toPayload(draft({ ...filled, create_login: false }))
    expect(payload.password).toBeUndefined()
    expect(payload.email).toBe('meera@crew.in')
  })

  it('sends the salary as a number', () => {
    expect(toPayload(draft({ ...filled, salary: '45000' })).salary).toBe(45000)
  })

  it('produces a payload the contract accepts', () => {
    expect(() => toRequest(filled)).not.toThrow()
    expect(() => toRequest(draft({ ...filled, email: '' }))).toThrow()
  })
})
