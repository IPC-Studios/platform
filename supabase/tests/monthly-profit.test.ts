import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import { beforeAll, describe, expect, it } from 'vitest'

/**
 * The Monthly profit screen's numbers, run as SQL against every migration.
 *
 * "Monthly team cost (5 buckets)" grouped team_payouts by `employment_type` —
 * a column that exists on no table in this schema. Every call threw, a bare
 * `catch` in the router swallowed it, and the card rendered five ₹0 tiles
 * underneath a non-zero salary figure. Typecheck could not see it (the column
 * name is inside a template literal), and no test ran the query.
 *
 * So this runs the real grouping SQL and asserts the thing a reader of the
 * screen assumes: the five tiles add up to the salary figure above them.
 */
const migDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'migrations')

const OWNER = '11111111-1111-1111-1111-111111111111'
const COMPANY = '22222222-2222-2222-2222-222222222222'
const SALARIED = '33333333-3333-3333-3333-333333333333'
const INTERN = '44444444-4444-4444-4444-444444444444'
const FREELANCE = '55555555-5555-5555-5555-555555555555'

/** The router's query, verbatim apart from the two bound parameters. */
const BUCKET_SQL = `
  select case
           when coalesce(u.stipend_amount, 0) > 0 then 'intern'
           when u.payout_type = 'salary'
             or (u.payout_type is null and u.engagement_type = 'in_house') then 'salaried'
           when u.engagement_type = 'freelancer'
             or u.payout_type in ('per_shoot', 'per_day', 'per_project') then 'contractor'
           when coalesce(u.commission_pct, 0) > 0 then 'commission'
           else 'other'
         end as bucket,
         coalesce(sum(tp.amount), 0) as total
    from team_payouts tp
    join users u on u.user_id = tp.user_id
   where tp.company_id = '${COMPANY}'
     and tp.created_at >= date_trunc('month', current_date)
     and tp.created_at < date_trunc('month', current_date) + interval '1 month'
   group by 1`

let db: PGlite

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

  // Every migration in order, read from disk — a new file cannot be missed.
  const files = readdirSync(migDir)
    .filter((f) => f.endsWith('.sql') && !f.startsWith('0000_'))
    .sort()
  for (const f of files) await db.exec(readFileSync(join(migDir, f), 'utf8'))

  await db.exec(`insert into auth.users (id, email) values
    ('${OWNER}', 'owner@studio.test'), ('${SALARIED}', 'sal@studio.test'),
    ('${INTERN}', 'intern@studio.test'), ('${FREELANCE}', 'free@studio.test');`)
  await db.exec(`
    insert into companies (id, name, owner_user_id) values ('${COMPANY}', 'Studio', '${OWNER}');
    insert into users (user_id, company_id, role, name, email, payout_type, engagement_type)
    values ('${OWNER}', '${COMPANY}', 'super_admin', 'Owner', 'owner@studio.test', 'salary', 'in_house'),
           ('${SALARIED}', '${COMPANY}', 'employee', 'Salaried', 'sal@studio.test', 'salary', 'in_house');
    insert into users (user_id, company_id, role, name, email, stipend_amount)
    values ('${INTERN}', '${COMPANY}', 'employee', 'Intern', 'intern@studio.test', 8000);
    insert into users (user_id, company_id, role, name, email, payout_type, engagement_type)
    values ('${FREELANCE}', '${COMPANY}', 'employee', 'Freelancer', 'free@studio.test', 'per_shoot', 'freelancer');
    insert into team_payouts (company_id, user_id, amount, period_start, period_end) values
      ('${COMPANY}', '${SALARIED}', 40000, current_date - 7, current_date),
      ('${COMPANY}', '${INTERN}', 8000, current_date - 7, current_date),
      ('${COMPANY}', '${FREELANCE}', 12000, current_date - 7, current_date),
      ('${COMPANY}', '${FREELANCE}', 6000, current_date - 3, current_date);
  `)
  await db.exec(`set request.jwt.claim.sub = '${OWNER}';`)
})

describe('monthly team cost buckets', () => {
  it('the grouping SQL runs at all — every column it names exists', async () => {
    const res = await db.query<{ bucket: string; total: string }>(BUCKET_SQL)
    expect(res.rows.length).toBeGreaterThan(0)
  })

  it('sorts each person into exactly one bucket, by how they are paid', async () => {
    const res = await db.query<{ bucket: string; total: string }>(BUCKET_SQL)
    const by = Object.fromEntries(res.rows.map((r) => [r.bucket, Number(r.total)]))
    expect(by).toEqual({ salaried: 40000, intern: 8000, contractor: 18000 })
  })

  it('the five tiles add up to the salary figure printed above them', async () => {
    const buckets = await db.query<{ total: string }>(BUCKET_SQL)
    const bucketTotal = buckets.rows.reduce((s, r) => s + Number(r.total), 0)

    const summary = await db.query<{ monthly_profit_summary: Record<string, unknown> }>(
      `select monthly_profit_summary(p_month => date_trunc('month', current_date)::date) as monthly_profit_summary;`,
    )
    const salaryCost = Number(summary.rows[0]!.monthly_profit_summary['salary_cost'])

    expect(bucketTotal).toBe(66000)
    expect(salaryCost).toBe(bucketTotal)
  })

  it('a payout from another month is not counted in this one', async () => {
    await db.exec(`
      insert into team_payouts (company_id, user_id, amount, period_start, period_end, created_at)
      values ('${COMPANY}', '${SALARIED}', 99000, current_date - 70, current_date - 60,
              date_trunc('month', current_date) - interval '2 months');`)
    const res = await db.query<{ total: string }>(BUCKET_SQL)
    expect(res.rows.reduce((s, r) => s + Number(r.total), 0)).toBe(66000)
  })
})
