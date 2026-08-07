import { describe, expect, it } from 'vitest'
import { canonicalStatus, priorityFromTone } from './tasks'

describe('priorityFromTone', () => {
  it('maps warm/hot tones to urgent/high', () => {
    expect(priorityFromTone('red')).toBe('urgent')
    expect(priorityFromTone('rose')).toBe('urgent')
    expect(priorityFromTone('orange')).toBe('high')
    expect(priorityFromTone('amber')).toBe('high')
  })
  it('maps cool tones to medium', () => {
    expect(priorityFromTone('blue')).toBe('medium')
    expect(priorityFromTone('purple')).toBe('medium')
  })
  it('is case-insensitive and defaults unknown/empty to low', () => {
    expect(priorityFromTone('RED')).toBe('urgent')
    expect(priorityFromTone('teal')).toBe('low')
    expect(priorityFromTone(null)).toBe('low')
    expect(priorityFromTone(undefined)).toBe('low')
  })
})

describe('canonicalStatus', () => {
  it('collapses built-in code statuses', () => {
    expect(canonicalStatus('pending_review')).toBe('in_progress')
    expect(canonicalStatus('revision_required')).toBe('in_progress')
    expect(canonicalStatus('sent_to_client')).toBe('completed')
  })
  it('uses the declared category for custom codes', () => {
    expect(canonicalStatus('client_qa', 'completed')).toBe('completed')
    expect(canonicalStatus('editing', 'in_progress')).toBe('in_progress')
  })
  it('built-in wins over a conflicting category', () => {
    expect(canonicalStatus('sent_to_client', 'to_do')).toBe('completed')
  })
  it('falls back to to_do with no code or category', () => {
    expect(canonicalStatus(null)).toBe('to_do')
    expect(canonicalStatus('mystery')).toBe('to_do')
  })
})
