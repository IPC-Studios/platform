import { describe, expect, it } from 'vitest'
import { crewState, findConflicts, overlaps, rolesFilled } from './slots'

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

describe('how much of a shoot is crewed', () => {
  const req = (name: string, quantity: number) => ({ name, quantity })
  const slot = (service_name: string, status = 'booked') => ({
    shoot_id: 'shoot-1',
    service_name,
    status,
  })

  it('is unplanned when nothing has been asked for', () => {
    // Not the same as "needs crew": a half-created shoot has nobody missing,
    // and putting it in the list of days to staff would bury the real ones.
    expect(crewState('shoot-1', [], [])).toBe('unplanned')
  })

  it('is unassigned when nobody is booked', () => {
    expect(crewState('shoot-1', [req('Photographer', 2)], [])).toBe('unassigned')
  })

  it('is partial when some roles are filled', () => {
    expect(crewState('shoot-1', [req('Photographer', 2)], [slot('Photographer')])).toBe('partial')
  })

  it('is full when every role is filled', () => {
    expect(
      crewState('shoot-1', [req('Photographer', 2)], [slot('Photographer'), slot('Photographer')]),
    ).toBe('full')
  })

  it('will not let one role cover another', () => {
    // The rule that makes this worth extracting. Three photographers do not
    // fill a day that also needs an editor — a per-shoot total would call this
    // fully crewed and nobody would edit the wedding.
    const requirements = [req('Photographer', 2), req('Editor', 1)]
    const slots = [slot('Photographer'), slot('Photographer'), slot('Photographer')]
    expect(rolesFilled('shoot-1', requirements, slots)).toBe(2)
    expect(crewState('shoot-1', requirements, slots)).toBe('partial')
  })

  it('ignores released and cancelled bookings', () => {
    // A released slot gave its time back; counting it would show a day as
    // staffed by somebody who is no longer coming.
    const requirements = [req('Photographer', 1)]
    expect(crewState('shoot-1', requirements, [slot('Photographer', 'released')])).toBe('unassigned')
    expect(crewState('shoot-1', requirements, [slot('Photographer', 'cancelled')])).toBe('unassigned')
  })

  it('ignores slots belonging to another shoot', () => {
    const other = { shoot_id: 'shoot-2', service_name: 'Photographer', status: 'booked' }
    expect(crewState('shoot-1', [req('Photographer', 1)], [other])).toBe('unassigned')
  })

  it('matches a role however it was typed', () => {
    // Service names are free text in places, so the same role arrives as
    // "Photographer", "photographer " and "PHOTOGRAPHER".
    expect(crewState('shoot-1', [req('Photographer', 1)], [slot('  photographer ')])).toBe('full')
  })

  it('does not count a spare beyond what was asked for', () => {
    expect(rolesFilled('shoot-1', [req('Photographer', 1)], [slot('Photographer'), slot('Photographer')])).toBe(1)
  })
})
