import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import { beforeAll, describe, expect, it } from 'vitest'

/**
 * crm_stats narrowed by source and by owner.
 *
 * The report offered a date range and nothing else, so "how is Instagram
 * doing" and "how is Priya doing" were both unanswerable. The filters are only
 * worth having if the numbers actually move, which is what these check — plus
 * the two traps: a blank source must mean "no filter" rather than a source
 * literally named '', and the old two-argument overload must be gone or
 * crm_stats(date, date) is an ambiguous-function error.
 */
const migDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'migrations')

const OWNER = '11111111-1111-1111-1111-111111111111'
const COMPANY = '22222222-2222-2222-2222-222222222222'
const PRIYA = '33333333-3333-3333-3333-333333333333'

let db: PGlite

const stats = async (args: string) => {
  const r = await db.query<{ s: Record<string, unknown> }>(`select crm_stats(${args}) as s;`)
  return r.rows[0]!.s
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

  const files = readdirSync(migDir)
    .filter((f) => f.endsWith('.sql') && !f.startsWith('0000_'))
    .sort()
  for (const f of files) await db.exec(readFileSync(join(migDir, f), 'utf8'))

  await db.exec(`insert into auth.users (id, email) values
    ('${OWNER}', 'owner@s.test'), ('${PRIYA}', 'priya@s.test');`)
  await db.exec(`
    insert into companies (id, name, owner_user_id) values ('${COMPANY}', 'Studio', '${OWNER}');
    insert into users (user_id, company_id, role, name, email) values
      ('${OWNER}', '${COMPANY}', 'super_admin', 'Owner', 'owner@s.test'),
      ('${PRIYA}', '${COMPANY}', 'employee', 'Priya', 'priya@s.test');
    insert into crm_leads (company_id, name, phone, source, assigned_to) values
      ('${COMPANY}', 'IG One',   '9000000001', 'instagram', '${PRIYA}'),
      ('${COMPANY}', 'IG Two',   '9000000002', 'instagram', '${OWNER}'),
      ('${COMPANY}', 'Web One',  '9000000003', 'webform',   '${PRIYA}'),
      ('${COMPANY}', 'Ref One',  '9000000004', 'referral',  null);
  `)
  await db.exec(`set request.jwt.claim.sub = '${OWNER}';`)
})

describe('crm_stats filters', () => {
  const range = `(current_date - 7)::date, current_date::date`

  it('counts everything when neither filter is given', async () => {
    const s = await stats(range)
    expect(Number(s['created'])).toBe(4)
    expect(Number(s['total'])).toBe(4)
  })

  it('narrows to one source', async () => {
    const s = await stats(`${range}, 'instagram', null`)
    expect(Number(s['created'])).toBe(2)
    expect(Number(s['total'])).toBe(2)
  })

  it('narrows to one owner', async () => {
    const s = await stats(`${range}, null, '${PRIYA}'::uuid`)
    expect(Number(s['created'])).toBe(2)
  })

  it('applies both together', async () => {
    const s = await stats(`${range}, 'instagram', '${PRIYA}'::uuid`)
    expect(Number(s['created'])).toBe(1)
  })

  it('treats a blank source as no filter, not as a source named ""', async () => {
    // A select that submits '' would otherwise report zero of everything.
    const blank = await stats(`${range}, '', null`)
    expect(Number(blank['created'])).toBe(4)
    const spaces = await stats(`${range}, '   ', null`)
    expect(Number(spaces['created'])).toBe(4)
  })

  it('the two-argument call still resolves, and is not ambiguous', async () => {
    // Leaving the old overload in place would make this error at call time.
    const s = await stats(range)
    expect(s).toHaveProperty('bySource')
    const overloads = await db.query<{ n: string }>(
      `select count(*) as n from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.proname = 'crm_stats';`,
    )
    expect(Number(overloads.rows[0]!.n)).toBe(1)
  })

  it('bySource respects the source filter', async () => {
    const s = await stats(`${range}, 'instagram', null`)
    expect(Object.keys(s['bySource'] as Record<string, number>)).toEqual(['instagram'])
  })
})
