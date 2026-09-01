import { describe, expect, it } from 'vitest'
import {
  EMPTY_DRAFT,
  canSubmit,
  draftTotals,
  estimatedDateFor,
  isDirty,
  newDeliverable,
  newPayment,
  newShoot,
  nextStep,
  prevStep,
  stepErrors,
  toProjectRequest,
  toShootRequests,
  type ProjectDraft,
} from './wizard'

const draft = (over: Partial<ProjectDraft> = {}): ProjectDraft => ({
  ...EMPTY_DRAFT,
  ...over,
})

const named = (over: Partial<ProjectDraft> = {}) =>
  draft({ name: 'Sharma Wedding', client_id: 'client-1', ...over })

describe('stepErrors', () => {
  it('requires a name and a client, and nothing else', () => {
    expect(stepErrors(EMPTY_DRAFT).client).toBe('Give the project a name.')
    expect(stepErrors(draft({ name: 'Sharma Wedding' })).client).toBe('Pick or add a client.')
    // A studio that just wants the project on the board should not have to
    // invent shoots or line items to get past step 2.
    expect(stepErrors(named())).toEqual({})
    expect(canSubmit(named())).toBe(true)
  })

  it('accepts a new client typed in place of a picked one', () => {
    expect(stepErrors(draft({ name: 'X', new_client_name: 'Verma Family' })).client).toBeUndefined()
  })

  it('catches half-filled rows in each section', () => {
    expect(stepErrors(named({ shoots: [newShoot()] })).shoots).toBe('Every shoot needs a name.')
    expect(stepErrors(named({ deliverables: [newDeliverable()] })).deliverables).toBe(
      'Every deliverable needs a title.',
    )
    expect(stepErrors(named({ payments: [newPayment()] })).billing).toBe(
      'Every payment needs an amount.',
    )
  })

  it('will not let a chargeable deliverable ship without a price', () => {
    const d = { ...newDeliverable(), title: 'Album', is_additional_charge: true }
    expect(stepErrors(named({ deliverables: [d] })).deliverables).toBe(
      'A chargeable deliverable needs an amount.',
    )
    expect(
      stepErrors(named({ deliverables: [{ ...d, additional_charge_amount: '15000' }] })).deliverables,
    ).toBeUndefined()
  })

  it('refuses to record more money than the project is worth', () => {
    const over = named({ package_cost: '50000', payments: [{ ...newPayment(), amount: '60000' }] })
    expect(stepErrors(over).billing).toBe('Payments received exceed the project total.')
    // With no price set yet there is nothing to exceed — that is step 4's job.
    expect(stepErrors(named({ payments: [{ ...newPayment(), amount: '60000' }] })).billing).toBeUndefined()
  })

  it('blocks submit on a problem in any step, not just the visible one', () => {
    expect(canSubmit(named({ shoots: [newShoot()] }))).toBe(false)
  })
})

describe('draftTotals', () => {
  const chargeable = (amount: string, over = {}) => ({
    ...newDeliverable(),
    title: 'Album',
    is_additional_charge: true,
    additional_charge_amount: amount,
    ...over,
  })

  it('adds up package, add-ons, received and balance', () => {
    const d = named({
      package_cost: '100000',
      deliverables: [chargeable('15000')],
      payments: [{ ...newPayment(), amount: '40000' }],
    })
    expect(draftTotals(d)).toEqual({
      packageCost: 100000,
      addOns: 15000,
      total: 115000,
      received: 40000,
      balance: 75000,
    })
  })

  it('follows the domain rule: internal and unquoted extras never add to price', () => {
    const internal = chargeable('9000', { visibility_scope: 'internal' })
    const unquoted = chargeable('9000', { show_on_quotation: false })
    expect(draftTotals(named({ deliverables: [internal, unquoted] })).addOns).toBe(0)
  })

  it('treats blank money fields as zero rather than NaN', () => {
    const totals = draftTotals(named({ package_cost: '', payments: [newPayment()] }))
    expect(totals.total).toBe(0)
    expect(totals.received).toBe(0)
  })

  it('never shows a negative balance', () => {
    const d = named({ package_cost: '1000', payments: [{ ...newPayment(), amount: '5000' }] })
    expect(draftTotals(d).balance).toBe(0)
  })
})

describe('estimatedDateFor', () => {
  const withShoots = named({
    shoots: [
      { ...newShoot(), name: 'Haldi', shoot_date: '2026-11-20' },
      { ...newShoot(), name: 'Wedding', shoot_date: '2026-11-22' },
    ],
  })

  it('dates a whole-project deliverable from the last shoot', () => {
    const d = { ...newDeliverable(), title: 'Album', lead_days: '45' }
    expect(estimatedDateFor(withShoots, d)).toBe('2027-01-06')
  })

  it('dates a pinned deliverable from its own shoot', () => {
    const d = { ...newDeliverable(), title: 'Teaser', start_rule: 'this_shoot' as const, shoot_index: 0, lead_days: '7' }
    expect(estimatedDateFor(withShoots, d)).toBe('2026-11-27')
  })

  it('stays unknown without shoots or without a lead time', () => {
    const d = { ...newDeliverable(), title: 'Album', lead_days: '45' }
    expect(estimatedDateFor(named(), d)).toBeNull()
    expect(estimatedDateFor(withShoots, { ...d, lead_days: '' })).toBeNull()
  })
})

describe('toProjectRequest', () => {
  it('drops blank rows instead of sending empties', () => {
    const d = named({
      shoots: [newShoot()],
      deliverables: [newDeliverable(), { ...newDeliverable(), title: 'Album' }],
      payments: [newPayment(), { ...newPayment(), amount: '20000' }],
    })
    const body = toProjectRequest(d, 'client-1')
    expect(body.deliverables).toHaveLength(1)
    expect(body.payments).toHaveLength(1)
    expect(toShootRequests(d, 'p1')).toHaveLength(0)
  })

  it('zeroes the amount on a deliverable that is not chargeable', () => {
    const d = named({
      deliverables: [
        { ...newDeliverable(), title: 'Reel', additional_charge_amount: '5000', is_additional_charge: false },
      ],
    })
    expect(toProjectRequest(d, 'c1').deliverables[0]!.additional_charge_amount).toBe(0)
  })

  it('carries the computed delivery date onto the payload', () => {
    const d = named({
      shoots: [{ ...newShoot(), name: 'Wedding', shoot_date: '2026-11-22' }],
      deliverables: [{ ...newDeliverable(), title: 'Album', lead_days: '45' }],
    })
    const sent = toProjectRequest(d, 'c1').deliverables[0]!
    expect(sent.estimated_date).toBe('2027-01-06')
    expect(sent.delivery_days_after_start).toBe(45)
  })

  it('omits optional fields rather than sending blanks', () => {
    const d = named({ deliverables: [{ ...newDeliverable(), title: 'Album' }] })
    const sent = toProjectRequest(d, 'c1').deliverables[0]!
    expect('estimated_date' in sent).toBe(false)
    expect('delivery_days_after_start' in sent).toBe(false)
  })

  it('builds one shoot request per named shoot, pinned to the project', () => {
    const d = named({
      shoots: [{ name: 'Wedding', shoot_date: '2026-11-22', location: 'Taj', status: 'confirmed' }],
    })
    expect(toShootRequests(d, 'proj-9')).toEqual([
      {
        project_id: 'proj-9',
        name: 'Wedding',
        status: 'confirmed',
        shoot_date: '2026-11-22',
        location: 'Taj',
      },
    ])
  })
})

describe('draft housekeeping', () => {
  it('knows an untouched draft is not worth restoring', () => {
    expect(isDirty(EMPTY_DRAFT)).toBe(false)
    expect(isDirty(draft({ name: 'x' }))).toBe(true)
    expect(isDirty(draft({ shoots: [newShoot()] }))).toBe(true)
    // The default toggle being on is not "work in progress".
    expect(isDirty(draft({ show_quotation: false }))).toBe(false)
  })

  it('walks the steps without falling off either end', () => {
    expect(prevStep('client')).toBe('client')
    expect(nextStep('review')).toBe('review')
    expect(nextStep('client')).toBe('shoots')
    expect(prevStep('billing')).toBe('deliverables')
  })
})
