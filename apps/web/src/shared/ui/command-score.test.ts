import { describe, expect, it } from 'vitest'
import { rankBy, scoreMatch } from './command-score'

const NAV = [
  'Dashboard',
  'Production Board',
  'Team Booking',
  'Data Management',
  'All Projects',
  'Create Project',
  'Project Tracking',
  'Task Management',
  'Payments',
  'Expenses',
  'Profitability',
  'CRM',
  'Clients',
  'Lead Sources',
  'Team Directory',
  'Attendance',
  'Roles & Access',
  'Settings',
]
const rank = (q: string, limit = 3) => rankBy(q, NAV, (s) => s, limit)

describe('scoreMatch', () => {
  it('ranks a name you started typing above one that merely contains it', () => {
    // "Task Management" starts with it; "Subtasks" only contains it.
    expect(scoreMatch('task', 'Task Management')!).toBeGreaterThan(
      scoreMatch('task', 'Subtasks')!,
    )
  })

  it('matches on any word, not just the first', () => {
    // "board" has to find Production Board or the palette feels broken.
    expect(scoreMatch('board', 'Production Board')).not.toBeNull()
    expect(rank('board')[0]).toBe('Production Board')
  })

  it('matches initials', () => {
    expect(rank('pb')[0]).toBe('Production Board')
    expect(rank('td')[0]).toBe('Team Directory')
  })

  it('falls back to scattered characters, but never above a real hit', () => {
    expect(scoreMatch('prft', 'Profitability')).not.toBeNull()
    // A substring hit must outrank a subsequence hit.
    expect(scoreMatch('pro', 'Production Board')!).toBeGreaterThan(
      scoreMatch('prft', 'Profitability')!,
    )
  })

  it('returns null when the characters are not all there, in order', () => {
    expect(scoreMatch('zzz', 'Dashboard')).toBeNull()
    expect(scoreMatch('drahsboad', 'Dashboard')).toBeNull()
  })

  it('is case and whitespace insensitive', () => {
    expect(scoreMatch('  DASH ', 'Dashboard')).toBe(scoreMatch('dash', 'Dashboard'))
  })

  it('prefers the shorter of two equally-good matches', () => {
    // Typing "team" should land on the shorter, more specific entry first.
    expect(scoreMatch('team', 'Team Booking')!).toBeGreaterThan(
      scoreMatch('team', 'Team Directory')!,
    )
  })
})

describe('rankBy', () => {
  it('returns everything, in the original order, for an empty query', () => {
    // The palette opens showing the nav as it is — not reshuffled.
    expect(rankBy('', NAV, (s) => s, 4)).toEqual(NAV.slice(0, 4))
  })

  it('honours the limit', () => {
    expect(rankBy('e', NAV, (s) => s, 2)).toHaveLength(2)
  })

  it('drops non-matches entirely', () => {
    expect(rankBy('qqqq', NAV, (s) => s)).toEqual([])
  })

  it('finds the real target for partial words people actually type', () => {
    expect(rank('prof')[0]).toBe('Profitability')
    expect(rank('att')[0]).toBe('Attendance')
    expect(rank('client')[0]).toBe('Clients')
    expect(rank('sett')[0]).toBe('Settings')
  })
})
