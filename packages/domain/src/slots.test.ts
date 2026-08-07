import { describe, expect, it } from 'vitest'
import { findConflicts, overlaps } from './slots'

const s = (a: string, b: string) => ({ start_at: `2026-06-01T${a}:00Z`, end_at: `2026-06-01T${b}:00Z` })

describe('overlaps', () => {
  it('detects overlapping ranges', () => {
    expect(overlaps(s('10:00', '12:00'), s('11:00', '13:00'))).toBe(true)
  })
  it('allows back-to-back (touching edges)', () => {
    expect(overlaps(s('10:00', '12:00'), s('12:00', '14:00'))).toBe(false)
  })
  it('detects containment', () => {
    expect(overlaps(s('10:00', '18:00'), s('12:00', '13:00'))).toBe(true)
  })
  it('disjoint ranges do not overlap', () => {
    expect(overlaps(s('10:00', '11:00'), s('12:00', '13:00'))).toBe(false)
  })
})

describe('findConflicts', () => {
  it('returns only the clashing existing slots', () => {
    const existing = [s('09:00', '10:00'), s('11:00', '13:00'), s('15:00', '16:00')]
    const conflicts = findConflicts(s('12:00', '15:30'), existing)
    expect(conflicts).toHaveLength(2)
  })
})
