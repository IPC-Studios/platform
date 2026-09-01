import type { DirectoryMember } from '@ipc/contracts'

/**
 * Directory filtering, sorting and export — kept pure and out of the component
 * so the rules are testable and the table stays a rendering concern.
 */

/** The "All / Freelance" segmented control above the filter card. */
export type DirectoryTab = 'all' | 'freelance'

export type SortKey = 'newest' | 'oldest' | 'name' | 'salary_high' | 'salary_low'

export interface DirectoryFilters {
  q: string
  /** Engagement: '', 'in_house' or 'freelancer'. */
  type: string
  /** Member status: '', 'active', 'inactive' or 'pending'. */
  status: string
  /**
   * One control, two kinds of role: `app:<role>` is the access ladder,
   * `job:<uuid>` is a studio's own job role. Empty means every role.
   */
  role: string
  minSalary: string
  maxSalary: string
  sort: SortKey
}

export const EMPTY_FILTERS: DirectoryFilters = {
  q: '',
  type: '',
  status: '',
  role: '',
  minSalary: '',
  maxSalary: '',
  sort: 'newest',
}

export const hasActiveFilters = (f: DirectoryFilters): boolean =>
  Boolean(f.q || f.type || f.status || f.role || f.minSalary || f.maxSalary)

const num = (v: string): number | null => {
  const n = Number(v)
  return v.trim() === '' || Number.isNaN(n) ? null : n
}

function matchesQuery(m: DirectoryMember, q: string): boolean {
  const needle = q.trim().toLowerCase()
  if (!needle) return true
  return [m.name, m.email, m.phone, m.alternate_phone, ...m.role_names]
    .filter(Boolean)
    .some((v) => String(v).toLowerCase().includes(needle))
}

function matchesRole(m: DirectoryMember, role: string): boolean {
  if (!role) return true
  const [kind, value] = role.split(':')
  return kind === 'app' ? m.role === value : m.role_ids.includes(value ?? '')
}

/**
 * A salary bound only ever narrows: a member whose salary is hidden (no
 * team_salaries access) or simply unset drops out once a bound is set, rather
 * than sitting in the results as an unverifiable maybe.
 */
function matchesSalary(m: DirectoryMember, min: number | null, max: number | null): boolean {
  if (min === null && max === null) return true
  if (m.salary === null) return false
  if (min !== null && m.salary < min) return false
  if (max !== null && m.salary > max) return false
  return true
}

const byName = (a: DirectoryMember, b: DirectoryMember) => a.name.localeCompare(b.name)

/** Nulls sink in both directions — an unknown salary is never the top result. */
const bySalary = (dir: 'high' | 'low') => (a: DirectoryMember, b: DirectoryMember) => {
  if (a.salary === null || b.salary === null) {
    if (a.salary === b.salary) return byName(a, b)
    return a.salary === null ? 1 : -1
  }
  if (a.salary === b.salary) return byName(a, b)
  return dir === 'high' ? b.salary - a.salary : a.salary - b.salary
}

const SORTS: Record<SortKey, (a: DirectoryMember, b: DirectoryMember) => number> = {
  newest: (a, b) => b.created_at.localeCompare(a.created_at) || byName(a, b),
  oldest: (a, b) => a.created_at.localeCompare(b.created_at) || byName(a, b),
  name: byName,
  salary_high: bySalary('high'),
  salary_low: bySalary('low'),
}

export function filterDirectory(
  rows: readonly DirectoryMember[],
  tab: DirectoryTab,
  f: DirectoryFilters,
): DirectoryMember[] {
  const min = num(f.minSalary)
  const max = num(f.maxSalary)
  return rows
    .filter((m) => (tab === 'freelance' ? m.engagement_type === 'freelancer' : true))
    .filter((m) => (f.type ? m.engagement_type === f.type : true))
    .filter((m) => (f.status ? m.status === f.status : true))
    .filter((m) => matchesRole(m, f.role))
    .filter((m) => matchesSalary(m, min, max))
    .filter((m) => matchesQuery(m, f.q))
    .sort(SORTS[f.sort])
}

const csvCell = (v: string | number | null): string => {
  const s = v === null ? '' : String(v)
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

export const CSV_HEADERS = [
  'Name',
  'Email',
  'Phone',
  'Alternate phone',
  'Access role',
  'Job roles',
  'Engagement',
  'Status',
  'Login',
  'Salary',
  'Joined',
] as const

/**
 * CSV of exactly what is on screen — the filtered rows, in their current order.
 * Salary is whatever the API returned, so an export can never widen what the
 * exporter was allowed to see.
 */
export function toCsv(rows: readonly DirectoryMember[]): string {
  const lines = rows.map((m) =>
    [
      m.name,
      m.email,
      m.phone,
      m.alternate_phone,
      m.role,
      m.role_names.join(' / '),
      m.engagement_type,
      m.status,
      m.login_enabled ? 'yes' : 'no',
      m.salary,
      m.created_at.slice(0, 10),
    ]
      .map(csvCell)
      .join(','),
  )
  return [CSV_HEADERS.join(','), ...lines].join('\n')
}
