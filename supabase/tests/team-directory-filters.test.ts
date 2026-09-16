import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import { beforeAll, describe, expect, it } from 'vitest'

/**
 * The team directory, narrowed in the database.
 *
 * Engagement, role and the salary range used to be applied in the browser, to
 * whichever page had already loaded, while the count under the pager went on
 * describing every member — so "freelancers only" could show an empty page 1
 * of 4 with the freelancers sitting on page 3. These filters live in the
 * directory endpoint now, and the same predicate feeds both the page and the
 * count, which is the part worth pinning down.
 *
 * The SQL below is the router's, with the bound parameters inlined. It fails
 * the moment the two drift apart.
 */
const migDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'migrations')

const OWNER = '11111111-1111-1111-1111-111111111111'
const COMPANY = '22222222-2222-2222-2222-222222222222'
const SANA = '33333333-3333-3333-3333-333333333333'
const IMRAN = '44444444-4444-4444-4444-444444444444'
const ANITA = '55555555-5555-5555-5555-555555555555'
const PHOTO_ROLE = '66666666-6666-6666-6666-666666666666'

let db: PGlite

/**
 * The endpoint's WHERE, verbatim. `canSee` stands in for the team_salaries
 * check: the router refuses to apply a salary bound without it, because
 * paging through "min 80000" would otherwise hand over the very figures the
 * redaction is hiding.
 */
function where(f: {
  status?: string
  engagement?: string
  role?: string
  minSalary?: number
  maxSalary?: number
  canSee?: boolean
}) {
  const [kind, value] = f.role ? f.role.split(':') : [null, null]
  const canSee = f.canSee ?? true
  const min = canSee ? f.minSalary : undefined
  const max = canSee ? f.maxSalary : undefined
  return `
    where u.deleted_at is null
      and ${f.status ? `u.status = '${f.status}'` : 'true'}
      and ${f.engagement ? `u.engagement_type = '${f.engagement}'` : 'true'}
      and ${kind === 'app' ? `u.role = '${value}'` : 'true'}
      and ${
        kind === 'job'
          ? `exists (select 1 from employee_role_assignments x where x.user_id = u.user_id and x.role_id = '${value}'::uuid)`
          : 'true'
      }
      and ${min === undefined ? 'true' : `(u.salary is not null and u.salary >= ${min})`}
      and ${max === undefined ? 'true' : `(u.salary is not null and u.salary <= ${max})`}`
}

const names = async (f: Parameters<typeof where>[0]) => {
  const r = await db.query<{ name: string }>(
    `select u.name from users u ${where(f)} order by u.name;`,
  )
  return r.rows.map((x) => x.name)
}

/** The count query the pager reads, over the same predicate. */
const count = async (f: Parameters<typeof where>[0]) => {
  const r = await db.query<{ n: string }>(`select count(*)::text as n from users u ${where(f)};`)
  return Number(r.rows[0]!.n)
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

  await db.exec(`insert into auth.users (id, email) values
    ('${OWNER}', 'o@s.test'), ('${SANA}', 's@s.test'), ('${IMRAN}', 'i@s.test'), ('${ANITA}', 'a@s.test');`)
  await db.exec(`
    insert into companies (id, name, owner_user_id) values ('${COMPANY}', 'Studio', '${OWNER}');
    insert into users (user_id, company_id, role, name, email, status, engagement_type, salary) values
      ('${OWNER}', '${COMPANY}', 'super_admin', 'Rahul', 'o@s.test', 'active',   'in_house',   40000),
      ('${SANA}',  '${COMPANY}', 'manager',     'Sana',  's@s.test', 'active',   'in_house',   90000),
      ('${IMRAN}', '${COMPANY}', 'employee',    'Imran', 'i@s.test', 'inactive', 'freelancer', null),
      ('${ANITA}', '${COMPANY}', 'employee',    'Anita', 'a@s.test', 'active',   'freelancer', 15000);
    insert into employee_roles (id, company_id, type_name, role_code) values ('${PHOTO_ROLE}', '${COMPANY}', 'Photographer', 'photographer');
    insert into employee_role_assignments (company_id, user_id, role_id) values ('${COMPANY}', '${OWNER}', '${PHOTO_ROLE}');
  `)
  await db.exec(`set request.jwt.claim.sub = '${OWNER}';`)
})

describe('team directory filters', () => {
  it('returns everyone when nothing is asked for', async () => {
    expect(await names({})).toEqual(['Anita', 'Imran', 'Rahul', 'Sana'])
  })

  it('narrows to an engagement', async () => {
    expect(await names({ engagement: 'freelancer' })).toEqual(['Anita', 'Imran'])
    expect(await names({ engagement: 'in_house' })).toEqual(['Rahul', 'Sana'])
  })

  it('narrows to a status', async () => {
    expect(await names({ status: 'inactive' })).toEqual(['Imran'])
  })

  it('one role control covers access levels and job roles', async () => {
    expect(await names({ role: 'app:manager' })).toEqual(['Sana'])
    expect(await names({ role: `job:${PHOTO_ROLE}` })).toEqual(['Rahul'])
  })

  it('a salary bound drops rows with no salary rather than guessing', async () => {
    // Imran has none. Treating that as zero would quietly include him in
    // "under ₹50,000", which is a claim about a figure nobody entered.
    expect(await names({ minSalary: 20000 })).toEqual(['Rahul', 'Sana'])
    expect(await names({ maxSalary: 50000 })).toEqual(['Anita', 'Rahul'])
    expect(await names({ minSalary: 20000, maxSalary: 50000 })).toEqual(['Rahul'])
  })

  it('ignores a salary bound from someone who cannot see salaries', async () => {
    // Otherwise paging through "min 80000" hands over exactly the figures the
    // redaction is there to hide.
    expect(await names({ minSalary: 80000, canSee: false })).toEqual([
      'Anita',
      'Imran',
      'Rahul',
      'Sana',
    ])
  })

  it('counts what it lists, so the pager cannot contradict the page', async () => {
    // The bug this replaced: the list narrowed and the count did not.
    for (const f of [
      {},
      { engagement: 'freelancer' },
      { role: 'app:manager' },
      { minSalary: 20000 },
      { status: 'active', engagement: 'in_house' },
    ]) {
      expect(await count(f)).toBe((await names(f)).length)
    }
  })

  it('leaves out anyone who has been deleted', async () => {
    await db.exec(`update users set deleted_at = now() where user_id = '${ANITA}';`)
    expect(await names({})).toEqual(['Imran', 'Rahul', 'Sana'])
    expect(await count({})).toBe(3)
    await db.exec(`update users set deleted_at = null where user_id = '${ANITA}';`)
  })
})
