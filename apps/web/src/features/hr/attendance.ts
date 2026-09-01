import type { AttendanceDayRow } from '@ipc/contracts'

/**
 * The attendance dashboard's arithmetic.
 *
 * The recorded status says what happened at the door; whether someone is still
 * inside is a question about the two timestamps. Deriving it here — rather than
 * storing a fourth status — means it can never disagree with the times shown
 * beside it.
 */
export type DisplayStatus = 'present' | 'late' | 'absent' | 'not_checked_out'

export function displayStatus(row: AttendanceDayRow): DisplayStatus {
  if (row.check_in_at && !row.check_out_at) return 'not_checked_out'
  return row.status
}

export const STATUS_LABEL: Record<DisplayStatus, string> = {
  present: 'Present',
  late: 'Late',
  absent: 'Absent',
  not_checked_out: 'Not checked out',
}

export const STATUS_TONE: Record<DisplayStatus, 'success' | 'warning' | 'danger' | 'info'> = {
  present: 'success',
  late: 'warning',
  absent: 'danger',
  not_checked_out: 'info',
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
export function summarise(rows: readonly AttendanceDayRow[]): AttendanceSummary {
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

export interface AttendanceFilters {
  search: string
  status: DisplayStatus | 'all'
  /** Engagement: '', 'in_house' or 'freelancer'. */
  type: string
}

export const EMPTY_FILTERS: AttendanceFilters = { search: '', status: 'all', type: '' }

export const hasFilters = (f: AttendanceFilters): boolean =>
  f.search.trim() !== '' || f.status !== 'all' || f.type !== ''

function matchesSearch(row: AttendanceDayRow, search: string): boolean {
  const needle = search.trim().toLowerCase()
  if (!needle) return true
  return [row.name, row.email, row.phone]
    .filter(Boolean)
    .some((v) => String(v).toLowerCase().includes(needle))
}

export function filterRows(
  rows: readonly AttendanceDayRow[],
  filters: AttendanceFilters,
): AttendanceDayRow[] {
  return rows
    .filter((r) => (filters.status === 'all' ? true : displayStatus(r) === filters.status))
    .filter((r) => (filters.type ? r.engagement_type === filters.type : true))
    .filter((r) => matchesSearch(r, filters.search))
}

const timeFormat = new Intl.DateTimeFormat('en-IN', { hour: 'numeric', minute: '2-digit' })

/** "9:04 am", or a dash — never an empty cell that reads as a rendering bug. */
export const formatTime = (iso: string | null): string =>
  iso ? timeFormat.format(new Date(iso)) : '—'

/** Hours between check-in and check-out, to one decimal. Null while still in. */
export function hoursWorked(row: AttendanceDayRow): number | null {
  if (!row.check_in_at || !row.check_out_at) return null
  const ms = new Date(row.check_out_at).getTime() - new Date(row.check_in_at).getTime()
  if (Number.isNaN(ms) || ms < 0) return null
  return Math.round((ms / 3_600_000) * 10) / 10
}

const csvCell = (v: string | number | null): string => {
  const s = v === null ? '' : String(v)
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

export const CSV_HEADERS = [
  'Name',
  'Email',
  'Phone',
  'Engagement',
  'Status',
  'Checked in',
  'Checked out',
  'Hours',
] as const

/** CSV of the rows on screen — the filtered set, in the order shown. */
export function toCsv(rows: readonly AttendanceDayRow[]): string {
  const lines = rows.map((r) =>
    [
      r.name,
      r.email,
      r.phone,
      r.engagement_type,
      STATUS_LABEL[displayStatus(r)],
      r.check_in_at,
      r.check_out_at,
      hoursWorked(r),
    ]
      .map(csvCell)
      .join(','),
  )
  return [CSV_HEADERS.join(','), ...lines].join('\n')
}

/** Today in the browser's timezone, as the date input wants it. */
export const todayISO = (now: Date = new Date()): string =>
  `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
