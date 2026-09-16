import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import { beforeAll, describe, expect, it } from 'vitest'

/**
 * Inserting a work submission as the `authenticated` role.
 *
 * team_work_submissions was designed to be written only through SECURITY
 * DEFINER functions, so 0010 gave it a SELECT policy and no write policy.
 * POST /work/submissions later began inserting directly — the RPC predates the
 * hard-disk/folder handover columns — and a direct insert runs under RLS, so
 * every submission was refused with 42501. The submit → review → deliver chain
 * was dead at the first step, for everyone including the owner.
 *
 * Two things this file has to get right, both of which caught me out:
 *
 *  - It applies the table grants from deploy/db/00_bootstrap.sql. Production
 *    sets those as DEFAULT PRIVILEGES before any table exists; a harness that
 *    skips them fails with "permission denied for table" — a GRANT error that
 *    looks nothing like the RLS refusal being tested, and would send you after
 *    the wrong bug.
 *  - It uses `set role`, not `set local role`. `set local` outside an explicit
 *    transaction silently does nothing, so the statements run as the superuser,
 *    RLS is bypassed entirely, and every assertion passes for the wrong reason.
 */
const migDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'migrations')

const OWNER = '11111111-1111-1111-1111-111111111111'
const COMPANY = '22222222-2222-2222-2222-222222222222'
const MEMBER = '33333333-3333-3333-3333-333333333333'
const OUTSIDER = '44444444-4444-4444-4444-444444444444'
const OTHER_CO = '55555555-5555-5555-5555-555555555555'
const PROJECT = '66666666-6666-6666-6666-666666666666'
const CLIENT = '77777777-7777-7777-7777-777777777777'

let db: PGlite

/** Run one statement the way the API does: as `authenticated`, as this user. */
async function asUser<T>(uid: string, sql: string) {
  await db.exec(`set role authenticated;`)
  await db.exec(`set request.jwt.claim.sub = '${uid}';`)
  try {
    return await db.query<T>(sql)
  } finally {
    await db.exec(`reset role;`)
  }
}

const countRows = async () => {
  const r = await db.query<{ n: number }>(`select count(*)::int as n from team_work_submissions;`)
  return r.rows[0]!.n
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

  // The privileges production grants in 00_bootstrap.sql, before any table
  // exists. Without these, RLS never gets a say.
  await db.exec(`grant usage on schema public to anon, authenticated, service_role;`)
  // Production grants this too (00_bootstrap.sql). Without it, a policy that
  // calls auth.uid() fails with "permission denied for schema auth" — which
  // reads as a policy rejection and is not one.
  await db.exec(`grant usage on schema auth to anon, authenticated, service_role;`)
  await db.exec(
    `alter default privileges in schema public grant select, insert, update, delete on tables to authenticated, service_role;`,
  )
  await db.exec(
    `alter default privileges in schema public grant usage, select on sequences to authenticated, service_role;`,
  )
  await db.exec(`alter default privileges in schema public grant execute on functions to authenticated, service_role;`)

  const files = readdirSync(migDir)
    .filter((f) => f.endsWith('.sql') && !f.startsWith('0000_'))
    .sort()
  for (const f of files) await db.exec(readFileSync(join(migDir, f), 'utf8'))

  await db.exec(`insert into auth.users (id, email) values
    ('${OWNER}', 'owner@s.test'), ('${MEMBER}', 'member@s.test'), ('${OUTSIDER}', 'out@s.test');`)
  await db.exec(`
    insert into companies (id, name, owner_user_id) values
      ('${COMPANY}', 'Studio', '${OWNER}'),
      ('${OTHER_CO}', 'Other Studio', '${OUTSIDER}');
    insert into users (user_id, company_id, role, name, email) values
      ('${OWNER}',    '${COMPANY}',  'super_admin', 'Owner',  'owner@s.test'),
      ('${MEMBER}',   '${COMPANY}',  'employee',    'Member', 'member@s.test'),
      ('${OUTSIDER}', '${OTHER_CO}', 'super_admin', 'Out',    'out@s.test');
    insert into clients (id, company_id, name) values ('${CLIENT}', '${COMPANY}', 'A Client');
    insert into projects (id, company_id, client_id, name)
    values ('${PROJECT}', '${COMPANY}', '${CLIENT}', 'Wedding');
  `)
})

const insert = (by: string, company: string, title: string) =>
  `insert into team_work_submissions (company_id, project_id, submitted_by, title, submission_link)
   values ('${company}', '${PROJECT}', '${by}', '${title}', 'https://example.test/x') returning id;`

describe('team_work_submissions insert', () => {
  it('a member can submit their own work', async () => {
    const r = await asUser<{ id: string }>(MEMBER, insert(MEMBER, COMPANY, 'Haldi edit'))
    expect(r.rows.length).toBe(1)
  })

  it('the owner can submit too', async () => {
    const r = await asUser<{ id: string }>(OWNER, insert(OWNER, COMPANY, 'Owner cut'))
    expect(r.rows.length).toBe(1)
  })

  it('you cannot submit in someone else’s name', async () => {
    const before = await countRows()
    await expect(asUser(MEMBER, insert(OWNER, COMPANY, 'Not mine'))).rejects.toThrow()
    expect(await countRows()).toBe(before)
  })

  it('you cannot submit into another studio', async () => {
    const before = await countRows()
    await expect(asUser(OUTSIDER, insert(OUTSIDER, COMPANY, 'Cross tenant'))).rejects.toThrow()
    expect(await countRows()).toBe(before)
  })

  it('a submission cannot be deleted by hand', async () => {
    // RLS filters a DELETE rather than refusing it, so this asserts on what
    // survived — expecting a throw here would pass against a table that
    // happily deleted everything it could see.
    const before = await countRows()
    await asUser(MEMBER, `delete from team_work_submissions where company_id = '${COMPANY}';`)
    expect(await countRows()).toBe(before)
  })

  it('a member sees only their own submissions', async () => {
    const mine = await asUser<{ n: number }>(
      MEMBER,
      `select count(*)::int as n from team_work_submissions;`,
    )
    expect(mine.rows[0]!.n).toBe(1)
  })
})
