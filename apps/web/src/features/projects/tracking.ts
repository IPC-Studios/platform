import { projectHealth, type NextActionKey, type ProjectHealth } from '@ipc/domain'
import type { ProjectTrackingRow } from '@ipc/contracts'

/**
 * The tracking board's filtering and ordering.
 *
 * Health scoring lives in @ipc/domain; this only decides which bucket a scored
 * project falls into and how the list is arranged. Both stay pure so the tabs'
 * counts and the list can never disagree — they are computed from the same
 * array in the same pass.
 */
export type TrackingTab =
  | 'all'
  | 'critical'
  | 'high_risk'
  | 'low_progress'
  | 'data_missing'
  | 'overdue'
  | 'pending_review'
  | 'completed'

export const TRACKING_TABS: ReadonlyArray<{ value: TrackingTab; label: string }> = [
  { value: 'all', label: 'All' },
  { value: 'critical', label: 'Critical' },
  { value: 'high_risk', label: 'High risk' },
  { value: 'low_progress', label: 'Low progress' },
  { value: 'data_missing', label: 'Data missing' },
  { value: 'overdue', label: 'Overdue' },
  { value: 'pending_review', label: 'Pending review' },
  { value: 'completed', label: 'Completed' },
]

export type TrackingSort = 'risk' | 'completion' | 'next_shoot' | 'name'

export const TRACKING_SORTS: ReadonlyArray<{ value: TrackingSort; label: string }> = [
  { value: 'risk', label: 'Highest risk first' },
  { value: 'completion', label: 'Lowest completion first' },
  { value: 'next_shoot', label: 'Next shoot first' },
  { value: 'name', label: 'Name (A–Z)' },
]

/** A row with its verdict attached, which is what the page renders. */
export interface TrackedProject extends ProjectTrackingRow {
  health: ProjectHealth
}

export function track(rows: readonly ProjectTrackingRow[], today: string): TrackedProject[] {
  return rows.map((row) => ({ ...row, health: projectHealth(row, today) }))
}

export function matchesTab(p: TrackedProject, tab: TrackingTab): boolean {
  const f = p.health.flags
  switch (tab) {
    case 'all':
      return true
    case 'critical':
      return f.critical
    case 'high_risk':
      return f.high_risk
    case 'low_progress':
      return f.low_progress
    case 'data_missing':
      return f.data_missing
    case 'overdue':
      return f.overdue
    case 'pending_review':
      return f.pending_review
    case 'completed':
      return f.completed
  }
}

/** Count per tab, so a tab reading 0 is never hiding something. */
export function tabCounts(projects: readonly TrackedProject[]): Record<TrackingTab, number> {
  const counts = {} as Record<TrackingTab, number>
  for (const { value } of TRACKING_TABS) {
    counts[value] = projects.filter((p) => matchesTab(p, value)).length
  }
  return counts
}

const byName = (a: TrackedProject, b: TrackedProject) => a.name.localeCompare(b.name)

const SORTS: Record<TrackingSort, (a: TrackedProject, b: TrackedProject) => number> = {
  risk: (a, b) => b.health.score - a.health.score || byName(a, b),
  completion: (a, b) => a.health.completion - b.health.completion || byName(a, b),
  // A project with no shoot booked has no date to sort by; it sinks rather than
  // sorting as "soonest".
  next_shoot: (a, b) => {
    if (a.next_shoot_date === b.next_shoot_date) return byName(a, b)
    if (!a.next_shoot_date) return 1
    if (!b.next_shoot_date) return -1
    return a.next_shoot_date.localeCompare(b.next_shoot_date)
  },
  name: byName,
}

export function filterAndSort(
  projects: readonly TrackedProject[],
  tab: TrackingTab,
  sort: TrackingSort,
): TrackedProject[] {
  return projects.filter((p) => matchesTab(p, tab)).sort(SORTS[sort])
}

/** The project to put at the top of the page, or null on a quiet board. */
export function mostUrgent(projects: readonly TrackedProject[]): TrackedProject | null {
  const ranked = [...projects]
    .filter((p) => p.health.score > 0)
    .sort((a, b) => b.health.score - a.health.score)
  return ranked[0] ?? null
}

/** Board-wide totals for the tiles across the top. */
export function summary(projects: readonly TrackedProject[]) {
  return {
    critical: projects.filter((p) => p.health.flags.critical).length,
    low_progress: projects.filter((p) => p.health.flags.low_progress).length,
    data_missing: projects.reduce((n, p) => n + p.data_records_unverified, 0),
    overdue: projects.reduce((n, p) => n + p.tasks_overdue, 0),
    pending_review: projects.reduce((n, p) => n + p.pending_reviews, 0),
  }
}

/** What the recommended action reads as on screen. */
export const NEXT_ACTION_LABEL: Record<NextActionKey, string> = {
  secure_data: 'Back up and verify the shoot data',
  clear_overdue: 'Clear the overdue tasks',
  review_submissions: 'Review the submitted work',
  plan_work: 'Break the deliverables into tasks',
  schedule_shoot: 'Schedule the first shoot',
  deliver: 'Deliver and close the project',
  keep_going: 'On track — keep going',
  none: 'Nothing to do',
}

export const BAND_LABEL = {
  critical: 'Critical',
  high: 'High risk',
  low_progress: 'Low progress',
  healthy: 'On track',
  completed: 'Completed',
} as const

export const BAND_TONE = {
  critical: 'danger',
  high: 'warning',
  low_progress: 'warning',
  healthy: 'success',
  completed: 'neutral',
} as const
