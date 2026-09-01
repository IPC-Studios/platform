import { describe, expect, it } from 'vitest'
import { dashboardSections, type DashboardCounts } from './dashboard-sections'

const empty: DashboardCounts = {
  activeProjects: 0,
  clients: 0,
  teamMembers: 1, // the owner, from registration
  outstanding: 0,
  recentProjects: 0,
}

describe('dashboardSections', () => {
  it('hides the wall of zeros while the journey is still guiding', () => {
    expect(dashboardSections(empty, true)).toEqual({ stats: false, recentProjects: false })
  })

  it('keeps everything once the journey is gone, however empty the studio is', () => {
    // An established studio that emptied out still gets its dashboard, and its
    // empty states, rather than a page that silently loses sections.
    expect(dashboardSections(empty, false)).toEqual({ stats: true, recentProjects: true })
  })

  it('brings the tiles back as soon as one number is real', () => {
    expect(dashboardSections({ ...empty, clients: 1 }, true).stats).toBe(true)
    expect(dashboardSections({ ...empty, activeProjects: 1 }, true).stats).toBe(true)
    expect(dashboardSections({ ...empty, outstanding: 5000 }, true).stats).toBe(true)
  })

  it('counts a second person as a real team, but the owner alone as nobody', () => {
    expect(dashboardSections({ ...empty, teamMembers: 1 }, true).stats).toBe(false)
    expect(dashboardSections({ ...empty, teamMembers: 2 }, true).stats).toBe(true)
  })

  it('shows recent projects independently of the tiles', () => {
    // Mid-journey: a project exists, so both come back even though the
    // journey is still running.
    const s = dashboardSections({ ...empty, recentProjects: 1 }, true)
    expect(s.recentProjects).toBe(true)
    expect(s.stats).toBe(false) // no active project, client, teammate or money yet
  })
})
