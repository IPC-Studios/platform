import { describe, it, expect } from 'vitest'
import { buildJourney, JOURNEY_STEPS, type StudioSignals } from './journey'

const EMPTY: StudioSignals = {
  teammates: 0,
  clients: 0,
  projects: 0,
  bookings: 0,
  dataRecords: 0,
  invoices: 0,
  trackedTasks: 0,
}

const ALL: StudioSignals = {
  teammates: 2,
  clients: 3,
  projects: 1,
  bookings: 4,
  dataRecords: 2,
  invoices: 1,
  trackedTasks: 9,
}

const state = (s: StudioSignals, key: string) =>
  buildJourney(s).steps.find((x) => x.key === key)?.state

describe('buildJourney', () => {
  it('starts a fresh studio at 0 of 7 with the team step current', () => {
    const j = buildJourney(EMPTY)
    expect(j.completed).toBe(0)
    expect(j.total).toBe(7)
    expect(j.allDone).toBe(false)
    expect(j.steps[0]?.state).toBe('current')
    expect(j.steps.slice(1).every((s) => s.state === 'upcoming')).toBe(true)
  })

  it('does not count the owner as a teammate', () => {
    // Registration creates exactly one user; the caller subtracts themselves,
    // so a brand-new studio reports 0 teammates and step 1 stays outstanding.
    expect(state(EMPTY, 'team')).toBe('current')
    expect(state({ ...EMPTY, teammates: 1 }, 'team')).toBe('done')
  })

  it('marks everything done and reports allDone', () => {
    const j = buildJourney(ALL)
    expect(j.completed).toBe(7)
    expect(j.allDone).toBe(true)
    expect(j.steps.every((s) => s.state === 'done')).toBe(true)
  })

  it('numbers steps from 1 in order', () => {
    expect(buildJourney(EMPTY).steps.map((s) => s.step)).toEqual([1, 2, 3, 4, 5, 6, 7])
  })

  it('keeps a step done even when an earlier one is not', () => {
    // Out-of-order progress is normal: a studio can add a client first.
    const j = buildJourney({ ...EMPTY, clients: 1 })
    expect(state({ ...EMPTY, clients: 1 }, 'client')).toBe('done')
    expect(j.completed).toBe(1)
  })

  it('points current at the FIRST outstanding step, not the one after the last done', () => {
    const s = { ...EMPTY, clients: 1, projects: 1 }
    expect(state(s, 'team')).toBe('current')
    expect(state(s, 'booking')).toBe('upcoming')
  })

  it('advances current as steps are finished', () => {
    expect(state({ ...EMPTY, teammates: 1 }, 'client')).toBe('current')
    expect(state({ ...EMPTY, teammates: 1, clients: 1 }, 'project')).toBe('current')
  })

  it('has exactly one current step while any remain', () => {
    for (const signals of [EMPTY, { ...EMPTY, teammates: 5 }, { ...ALL, invoices: 0 }]) {
      expect(buildJourney(signals).steps.filter((s) => s.state === 'current')).toHaveLength(1)
    }
  })

  it('has no current step once everything is done', () => {
    expect(buildJourney(ALL).steps.filter((s) => s.state === 'current')).toHaveLength(0)
  })

  it('hides steps whose module the user cannot reach, and renumbers', () => {
    const j = buildJourney(EMPTY, (m) => m !== 'billing')
    expect(j.total).toBe(6)
    expect(j.steps.map((s) => s.key)).not.toContain('payment')
    expect(j.steps.map((s) => s.step)).toEqual([1, 2, 3, 4, 5, 6])
  })

  it('reports allDone against visible steps only', () => {
    // Billing hidden: the studio is set up as far as this user is concerned.
    const j = buildJourney({ ...ALL, invoices: 0 }, (m) => m !== 'billing')
    expect(j.allDone).toBe(true)
  })

  it('sends every step somewhere', () => {
    for (const s of JOURNEY_STEPS) {
      expect(s.action.to.startsWith('/')).toBe(true)
      expect(s.action.label.length).toBeGreaterThan(0)
    }
  })
})
