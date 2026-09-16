/**
 * The attendance day roster: what counts as present, and who a filter keeps.
 *
 * This lived in `apps/web` while the API narrowed the same roster with its own
 * copy of the rule. Two implementations of "has this person checked out yet"
 * is one more than can be kept in agreement — and they only have to disagree
 * once for a row to carry a badge that contradicts the filter that found it.
 * Both sides import this now.
 *
 * The recorded status says what happened at the door; whether someone is
 * still inside is a question about the two timestamps. Deriving it rather
 * than storing a fourth status means it can never disagree with the times
 * shown beside it.
 */
export type DisplayStatus = 'present' | 'late' | 'absent' | 'not_checked_out'

/** The row shape this needs — the API's query result satisfies it too. */
export interface RosterRow {
  status: string
  check_in_at: string | null
  check_out_at: string | null
  engagement_type?: string | null
  name?: string | null
  email?: string | null
  phone?: string | null
}

export function displayStatus(row: RosterRow): DisplayStatus {
  if (row.check_in_at && !row.check_out_at) return 'not_checked_out'
  return row.status as DisplayStatus
}

export interface RosterFilters {
  /** '' or 'all' means every status. */
  status?: string | undefined
  /** Engagement: '', 'in_house' or 'freelancer'. */
  type?: string | undefined
}

/**
 * Whether one person belongs in the filtered roster.
 *
 * A status filter matches either the derived status or the stored one, so
 * asking for "late" still finds someone who came in late and has not checked
 * out — they are late, whatever the badge on the row currently reads.
 */
export function matchesRoster(row: RosterRow, f: RosterFilters): boolean {
  const wantStatus = f.status && f.status !== 'all' ? f.status : null
  if (wantStatus && displayStatus(row) !== wantStatus && row.status !== wantStatus) return false
  if (f.type && row.engagement_type !== f.type) return false
  return true
}

export interface AttendanceSummary {
  total: number
  present: number
  absent: number
  notCheckedOut: number
  /** Whole percent of the team that turned up at all. */
  percent: number
}

/**
 * Anyone who came in counts as present for the percentage — late is still
 * turning up, and someone who has not checked out has certainly arrived.
 */
export function summariseRoster(rows: readonly RosterRow[]): AttendanceSummary {
  const total = rows.length
  const turnedUp = rows.filter((r) => r.check_in_at !== null).length
  return {
    total,
    present: turnedUp,
    absent: rows.filter((r) => r.check_in_at === null).length,
    notCheckedOut: rows.filter((r) => displayStatus(r) === 'not_checked_out').length,
    // An empty roster is 0%, not a division by zero dressed up as NaN.
    percent: total === 0 ? 0 : Math.round((turnedUp / total) * 100),
  }
}

// `RosterRow` is deliberately structural rather than an import of the
// contract type: this package stays free of that dependency, and both the
// API's query result and the contract's row satisfy the shape as they are.
