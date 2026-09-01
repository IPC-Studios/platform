import { describe, expect, it } from 'vitest'
import type { DirectoryMember } from '@ipc/contracts'
import { EMPTY_FILTERS, filterDirectory, hasActiveFilters, toCsv } from './filters'

const member = (over: Partial<DirectoryMember> & { name: string }): DirectoryMember => ({
  user_id: `id-${over.name}`,
  email: null,
  role: 'employee',
  phone: null,
  alternate_phone: null,
  status: 'active',
  engagement_type: 'in_house',
  login_enabled: true,
  salary: null,
  address: null,
  created_at: '2026-06-01T10:00:00Z',
  role_names: [],
  role_ids: [],
  ...over,
})

const ROWS: DirectoryMember[] = [
  member({
    name: 'Rahul',
    email: 'rahul@studio.in',
    phone: '9811111111',
    salary: 45000,
    role_ids: ['role-photo'],
    role_names: ['Photographer'],
    created_at: '2026-05-01T10:00:00Z',
  }),
  member({
    name: 'Anita',
    engagement_type: 'freelancer',
    salary: 12000,
    created_at: '2026-07-01T10:00:00Z',
  }),
  member({ name: 'Sana', role: 'manager', salary: 68000, created_at: '2026-06-15T10:00:00Z' }),
  member({
    name: 'Imran',
    engagement_type: 'freelancer',
    status: 'inactive',
    login_enabled: false,
    created_at: '2026-08-01T10:00:00Z',
  }),
]

const names = (rows: readonly DirectoryMember[]) => rows.map((r) => r.name)

describe('filterDirectory', () => {
  it('defaults to everyone, newest first', () => {
    expect(names(filterDirectory(ROWS, 'all', EMPTY_FILTERS))).toEqual([
      'Imran',
      'Anita',
      'Sana',
      'Rahul',
    ])
  })

  it('the freelance tab keeps only freelancers', () => {
    expect(names(filterDirectory(ROWS, 'freelance', EMPTY_FILTERS))).toEqual(['Imran', 'Anita'])
  })

  it('searches name, email and phone', () => {
    const byEmail = filterDirectory(ROWS, 'all', { ...EMPTY_FILTERS, q: 'rahul@studio' })
    expect(names(byEmail)).toEqual(['Rahul'])
    const byPhone = filterDirectory(ROWS, 'all', { ...EMPTY_FILTERS, q: '98111' })
    expect(names(byPhone)).toEqual(['Rahul'])
    const byJobRole = filterDirectory(ROWS, 'all', { ...EMPTY_FILTERS, q: 'photographer' })
    expect(names(byJobRole)).toEqual(['Rahul'])
  })

  it('filters by status and engagement', () => {
    expect(names(filterDirectory(ROWS, 'all', { ...EMPTY_FILTERS, status: 'inactive' }))).toEqual([
      'Imran',
    ])
    expect(names(filterDirectory(ROWS, 'all', { ...EMPTY_FILTERS, type: 'in_house' }))).toEqual([
      'Sana',
      'Rahul',
    ])
  })

  it('one role control covers access levels and job roles', () => {
    expect(names(filterDirectory(ROWS, 'all', { ...EMPTY_FILTERS, role: 'app:manager' }))).toEqual([
      'Sana',
    ])
    expect(
      names(filterDirectory(ROWS, 'all', { ...EMPTY_FILTERS, role: 'job:role-photo' })),
    ).toEqual(['Rahul'])
  })

  it('a salary bound drops rows with no salary rather than guessing', () => {
    const rows = filterDirectory(ROWS, 'all', { ...EMPTY_FILTERS, minSalary: '20000' })
    expect(names(rows)).toEqual(['Sana', 'Rahul'])
    expect(names(filterDirectory(ROWS, 'all', { ...EMPTY_FILTERS, maxSalary: '50000' }))).toEqual([
      'Anita',
      'Rahul',
    ])
  })

  it('sorts by name and by salary, with unknown salaries last', () => {
    expect(names(filterDirectory(ROWS, 'all', { ...EMPTY_FILTERS, sort: 'name' }))).toEqual([
      'Anita',
      'Imran',
      'Rahul',
      'Sana',
    ])
    expect(names(filterDirectory(ROWS, 'all', { ...EMPTY_FILTERS, sort: 'salary_high' }))).toEqual([
      'Sana',
      'Rahul',
      'Anita',
      'Imran',
    ])
    expect(names(filterDirectory(ROWS, 'all', { ...EMPTY_FILTERS, sort: 'salary_low' }))).toEqual([
      'Anita',
      'Rahul',
      'Sana',
      'Imran',
    ])
  })

  it('does not mutate the rows it was given', () => {
    const original = names(ROWS)
    filterDirectory(ROWS, 'all', { ...EMPTY_FILTERS, sort: 'name' })
    expect(names(ROWS)).toEqual(original)
  })

  it('knows when a filter is actually set', () => {
    expect(hasActiveFilters(EMPTY_FILTERS)).toBe(false)
    expect(hasActiveFilters({ ...EMPTY_FILTERS, sort: 'name' })).toBe(false)
    expect(hasActiveFilters({ ...EMPTY_FILTERS, q: 'a' })).toBe(true)
  })
})

describe('toCsv', () => {
  it('writes a header plus one line per row', () => {
    const csv = toCsv(filterDirectory(ROWS, 'freelance', EMPTY_FILTERS))
    const lines = csv.split('\n')
    expect(lines[0]).toContain('Name,Email,Phone')
    expect(lines).toHaveLength(3)
    expect(lines[2]).toContain('Anita')
  })

  it('quotes anything that would break the format', () => {
    const csv = toCsv([member({ name: 'Roy, Jr.', address: 'He said "hi"' })])
    expect(csv).toContain('"Roy, Jr."')
  })

  it('exports the salary it was given — never more', () => {
    // Salary is blanked server-side for callers without team_salaries, so an
    // export cannot widen what the exporter could see.
    const csv = toCsv([member({ name: 'Hidden', salary: null })])
    expect(csv.split('\n')[1]).toContain('Hidden,,,,employee,,in_house,active,yes,,2026-06-01')
  })
})
