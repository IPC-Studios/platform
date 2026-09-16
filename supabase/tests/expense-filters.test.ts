import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import { beforeAll, describe, expect, it } from 'vitest'

/**
 * Company expenses: the list, its count and its tiles over ONE predicate.
 *
 * Two things were wrong. The summary endpoint filtered by date alone, so
 * "Total ₹4,80,000" sat above rows narrowed by category, project, amount and
 * a search — two numbers on one screen answering different questions. And the
 * page fetched two hundred rows and paginated them in the browser, so a
 * studio past its two-hundredth expense could not reach the rest, with a
 * pager that counted the 200 it had and gave no sign of the rest.
 *
 * The SQL below is the router's WHERE with its parameters inlined. Both the
 * list and the summary build on it, so these check the predicate once and
 * then check that the two readings of it agree.
 */
const migDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'migrations')

const OWNER = '11111111-1111-1111-1111-111111111111'
const COMPANY = '22222222-2222-2222-2222-222222222222'
const CLIENT = '33333333-3333-3333-3333-333333333333'
const PROJECT = '44444444-4444-4444-4444-444444444444'

let db: PGlite

type Filters = {
  project?: string
  category?: string
  dateFrom?: string
  dateTo?: string
  search?: string
  minAmount?: number
  maxAmount?: number
  gst?: 'gst_applicable' | 'exempt' | 'non_gst' | 'reverse_charge'
}

/** The router's expenseWhere(), inlined. */
const where = (f: Filters) => `
  where ${f.project ? `e.project_id = '${f.project}'` : 'true'}
    and ${f.category ? `e.category = '${f.category}'` : 'true'}
    and ${f.dateFrom ? `e.expense_date >= '${f.dateFrom}'::date` : 'true'}
    and ${f.dateTo ? `e.expense_date <= '${f.dateTo}'::date` : 'true'}
    and ${
      f.search
        ? `(e.description ilike '%${f.search}%' or e.invoice_number ilike '%${f.search}%')`
        : 'true'
    }
    and ${f.minAmount === undefined ? 'true' : `e.amount >= ${f.minAmount}`}
    and ${f.maxAmount === undefined ? 'true' : `e.amount <= ${f.maxAmount}`}
    and ${
      f.gst === 'reverse_charge'
        ? `(e.gst_treatment = 'reverse_charge' or e.reverse_charge = true)`
        : f.gst
          ? `e.gst_treatment = '${f.gst}'`
          : 'true'
    }`

/** The list query, one page of it. */
const listed = async (f: Filters, limit = 100, offset = 0) => {
  const r = await db.query<{ description: string }>(
    `select e.description from expenses e ${where(f)}
      order by e.expense_date desc limit ${limit} offset ${offset};`,
  )
  return r.rows.map((x) => x.description)
}

/** The tiles, over the same predicate. */
const tiles = async (f: Filters) => {
  const r = await db.query<Record<string, string>>(
    `select count(*)::int as count, coalesce(sum(e.amount), 0) as total,
            count(*) filter (where e.project_id is not null)::int as linked_count,
            count(distinct e.category) filter (where e.category is not null)::int as category_count
       from expenses e ${where(f)};`,
  )
  const row = r.rows[0]!
  return {
    count: Number(row['count']),
    total: Number(row['total']),
    linked: Number(row['linked_count']),
    cats: Number(row['category_count']),
  }
}

beforeAll(async () => {
  db = new PGlite()
  await db.exec(`create schema if not exists auth;`)
  await db.exec(
    `create table auth.users (id uuid primary key default gen_random_uuid(), email text unique not null, encrypted_password text);`,
  )
  await db.exec(
    `create or replace function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;`,
  )
  for (const r of ['authenticated', 'anon', 'service_role', 'authenticator']) await db.exec(`create role ${r};`)

  for (const f of readdirSync(migDir).filter((x) => x.endsWith('.sql') && !x.startsWith('0000_')).sort()) {
    await db.exec(readFileSync(join(migDir, f), 'utf8'))
  }

  await db.exec(`insert into auth.users (id, email) values ('${OWNER}', 'o@s.test');`)
  await db.exec(`
    insert into companies (id, name, owner_user_id) values ('${COMPANY}', 'Studio', '${OWNER}');
    insert into users (user_id, company_id, role, name, email) values
      ('${OWNER}', '${COMPANY}', 'super_admin', 'Owner', 'o@s.test');
    insert into clients (id, company_id, name) values ('${CLIENT}', '${COMPANY}', 'Mehta');
    insert into projects (id, company_id, client_id, name) values ('${PROJECT}', '${COMPANY}', '${CLIENT}', 'Mehta Wedding');
    insert into expenses (company_id, created_by, project_id, category, description, amount, expense_date, gst_treatment, reverse_charge, invoice_number) values
      ('${COMPANY}', '${OWNER}', '${PROJECT}', 'travel',    'Cab to venue',     1200, '2026-09-02', 'gst_applicable', false, 'INV-1'),
      ('${COMPANY}', '${OWNER}', '${PROJECT}', 'equipment', 'Lens hire',       18000, '2026-09-05', 'gst_applicable', true,  'INV-2'),
      ('${COMPANY}', '${OWNER}', null,         'office',    'Studio rent',     40000, '2026-09-01', 'non_gst', false, null),
      ('${COMPANY}', '${OWNER}', null,         'travel',    'Fuel',             3000, '2026-08-20', 'non_gst', false, null);
  `)
  await db.exec(`set request.jwt.claim.sub = '${OWNER}';`)
})

describe('company expense filters', () => {
  it('lists everything when nothing is asked for', async () => {
    expect((await listed({})).length).toBe(4)
  })

  it('narrows by category, project, amount and search', async () => {
    expect(await listed({ category: 'travel' })).toEqual(['Cab to venue', 'Fuel'])
    expect((await listed({ project: PROJECT })).length).toBe(2)
    expect(await listed({ minAmount: 20000 })).toEqual(['Studio rent'])
    expect(await listed({ search: 'Lens' })).toEqual(['Lens hire'])
    // Search covers the invoice number too, which is how people find a bill.
    expect(await listed({ search: 'INV-2' })).toEqual(['Lens hire'])
  })

  it('narrows by GST treatment, in the studio’s own vocabulary', async () => {
    // `exempt` is a treatment that carries no tax, so a with/without split
    // would file it under "with GST" and put untaxed rows beneath a tax tile.
    expect(await listed({ gst: 'gst_applicable' })).toEqual(['Lens hire', 'Cab to venue'])
    expect(await listed({ gst: 'non_gst' })).toEqual(['Studio rent', 'Fuel'])
    expect(await listed({ gst: 'exempt' })).toEqual([])
    // Reverse charge is recorded in two places; both count.
    expect(await listed({ gst: 'reverse_charge' })).toEqual(['Lens hire'])
  })

  it('bounds a date range at both ends', async () => {
    expect((await listed({ dateFrom: '2026-09-01' })).length).toBe(3)
    // Inclusive at both ends: the 1st and the 3rd are inside the range.
    expect(await listed({ dateFrom: '2026-09-01', dateTo: '2026-09-03' })).toEqual([
      'Cab to venue',
      'Studio rent',
    ])
  })

  it('the tiles describe the rows the list is showing', async () => {
    // The bug: the summary took a date range and nothing else, so these two
    // disagreed on every filter except the dates.
    for (const f of [
      {},
      { category: 'travel' } as Filters,
      { project: PROJECT } as Filters,
      { gst: 'gst_applicable' } as Filters,
      { minAmount: 20000 } as Filters,
      { dateFrom: '2026-09-01', dateTo: '2026-09-30' } as Filters,
    ]) {
      const rows = await listed(f)
      const t = await tiles(f)
      expect(t.count).toBe(rows.length)
    }
  })

  it('counts project-linked and categories over the whole set, not one page', async () => {
    const t = await tiles({})
    expect(t.linked).toBe(2)
    expect(t.cats).toBe(3)
    expect(t.total).toBe(62200)
    // A page of one must not change what the tiles say.
    expect((await listed({}, 1)).length).toBe(1)
    expect((await tiles({})).count).toBe(4)
  })

  it('pages past the first two hundred rows', async () => {
    // The browser-side pager capped the screen at 200 with nothing to say so.
    await db.exec(`
      insert into expenses (company_id, created_by, category, description, amount, expense_date, gst_treatment)
      select '${COMPANY}', '${OWNER}', 'bulk', 'Bulk ' || g, 100, '2026-07-01'::date, 'non_gst'
        from generate_series(1, 250) g;`)
    expect((await tiles({ category: 'bulk' })).count).toBe(250)
    // The 201st row is reachable, which is the whole point.
    const page3 = await listed({ category: 'bulk' }, 100, 200)
    expect(page3.length).toBe(50)
  })
})
