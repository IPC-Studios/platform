import { describe, expect, it } from 'vitest'
import { PLAN_SOURCE_LABEL, planSource } from './subscription'

describe('planSource', () => {
  it('calls an open account with no successful payment a trial', () => {
    expect(planSource('active', [])).toBe('trial')
    expect(planSource('active', [{ status: 'created' }, { status: 'failed' }])).toBe('trial')
  })

  it('calls an open account with a successful payment paid', () => {
    expect(planSource('active', [{ status: 'paid' }])).toBe('paid')
    // Razorpay says "captured"; our own activation path says "completed".
    expect(planSource('active', [{ status: 'captured' }])).toBe('paid')
    expect(planSource('active', [{ status: 'COMPLETED' }])).toBe('paid')
  })

  it('names the reason the doors are open when it is not a purchase', () => {
    expect(planSource('grandfathered', [{ status: 'paid' }])).toBe('grandfathered')
    expect(planSource('grace', [{ status: 'paid' }])).toBe('grace')
  })

  it('reports nothing rather than a trial once the plan has expired', () => {
    // An expired account is not on a trial — that read as "still fine".
    expect(planSource('expired', [])).toBe('none')
    expect(planSource('expired', [{ status: 'paid' }])).toBe('paid')
  })

  it('tolerates an order with no status at all', () => {
    expect(planSource('active', [{}, { status: null }])).toBe('trial')
  })

  it('has a label for every source', () => {
    for (const s of ['paid', 'trial', 'grandfathered', 'grace', 'none'] as const) {
      expect(PLAN_SOURCE_LABEL[s]).toBeTruthy()
    }
  })
})
