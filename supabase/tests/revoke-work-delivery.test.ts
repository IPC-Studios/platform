import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import { beforeAll, describe, expect, it } from 'vitest'

/**
 * Revoking a client delivery marks the submission.
 *
 * It did not. The route stamped `revoked_at` with a plain UPDATE, and
 * tws_update (0139) is scoped to `status = 'submitted'` — written for editing
 * a submission before review. Work is only ever sent to a client once it is
 * approved, so every revocable row failed that predicate. RLS filters an
 * UPDATE rather than refusing it, so the statement changed nothing and raised
 * nothing, and the route returned success regardless.
 *
 * The client's link did stop opening, because expiring the token is a definer
 * call. What was lost is the studio being able to see that it had happened —
 * which is what the Revoke button in My Work now renders.
 *
 * The check that matters here is the one the original code never made: that a
 * row was actually found.
 */
const migDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'migrations')

const OWNER = '11111111-1111-1111-1111-111111111111'
const MEMBER = '22222222-2222-2222-2222-222222222222'
const COMPANY = '33333333-3333-3333-3333-333333333333'
const CLIENT = '44444444-4444-4444-4444-444444444444'
const PROJECT = '55555555-5555-5555-5555-555555555555'

let db: PGlite

async function asUser<T>(uid: string, sql: string) {
  await db.exec(`set role authenticated;`)
  await db.exec(`set request.jwt.claim.sub = '${uid}';`)
  try {
    return await db.query<T>(sql)
  } finally {
    await db.exec(`reset role;`)
  }
}

const revokedAt = async (id: string) => {
  const r = await db.query<{ revoked_at: string | null }>(
    `select revoked_at from team_work_submissions where id = '${id}';`,
  )
  return r.rows[0]!.revoked_at
}

/** A submission in the state work is actually in when it gets sent. */
async function approvedSubmission(): Promise<string> {
  const r = await db.query<{ id: string }>(
    `insert into team_work_submissions (company_id, project_id, submitted_by, submission_link, status)
     values ('${COMPANY}', '${PROJECT}', '${MEMBER}', 'https://example.test/gallery', 'approved')
     returning id;`,
  )
  return r.rows[0]!.id
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
  await db.exec(`grant usage on schema public to anon, authenticated, service_role;`)
  await db.exec(`grant usage on schema auth to anon, authenticated, service_role;`)
  await db.exec(
    `alter default privileges in schema public grant select, insert, update, delete on tables to authenticated, service_role;`,
  )
  await db.exec(
    `alter default privileges in schema public grant usage, select on sequences to authenticated, service_role;`,
  )
  await db.exec(`alter default privileges in schema public grant execute on functions to authenticated, service_role;`)

  for (const f of readdirSync(migDir).filter((x) => x.endsWith('.sql') && !x.startsWith('0000_')).sort()) {
    await db.exec(readFileSync(join(migDir, f), 'utf8'))
  }

  await db.exec(`insert into auth.users (id, email) values ('${OWNER}', 'o@s.test'), ('${MEMBER}', 'm@s.test');`)
  await db.exec(`
    insert into companies (id, name, owner_user_id) values ('${COMPANY}', 'Studio', '${OWNER}');
    insert into users (user_id, company_id, role, name, email) values
      ('${OWNER}',  '${COMPANY}', 'super_admin', 'Owner',  'o@s.test'),
      ('${MEMBER}', '${COMPANY}', 'employee',    'Member', 'm@s.test');
    insert into clients (id, company_id, name) values ('${CLIENT}', '${COMPANY}', 'Mehta');
    insert into projects (id, company_id, client_id, name) values ('${PROJECT}', '${COMPANY}', '${CLIENT}', 'Mehta Wedding');
  `)
})

describe('revoke_work_delivery', () => {
  it('marks an APPROVED submission — the only state one is ever sent in', async () => {
    // The whole bug: a plain UPDATE here matched nothing, because the update
    // policy only admits `status = 'submitted'`.
    const id = await approvedSubmission()
    expect(await revokedAt(id)).toBeNull()

    const r = await asUser<{ revoke_work_delivery: boolean }>(
      OWNER,
      `select revoke_work_delivery('${id}') as revoke_work_delivery;`,
    )
    expect(r.rows[0]!.revoke_work_delivery).toBe(true)
    expect(await revokedAt(id)).not.toBeNull()
  })

  it('says so when there is no such submission, instead of reporting success', async () => {
    // The route used to return `true` whatever happened, which is how a
    // no-op looked identical to a revocation for as long as it shipped.
    const r = await asUser<{ revoke_work_delivery: boolean }>(
      OWNER,
      `select revoke_work_delivery('99999999-9999-9999-9999-999999999999') as revoke_work_delivery;`,
    )
    expect(r.rows[0]!.revoke_work_delivery).toBe(false)
  })

  it('marks the delivery row alongside the submission', async () => {
    const id = await approvedSubmission()
    await db.exec(`
      insert into team_work_client_deliveries (company_id, submission_id, channel)
      values ('${COMPANY}', '${id}', 'whatsapp');`)
    await asUser(OWNER, `select revoke_work_delivery('${id}');`)
    const r = await db.query<{ n: string }>(
      `select count(*)::text as n from team_work_client_deliveries
        where submission_id = '${id}' and revoked_at is not null;`,
    )
    expect(Number(r.rows[0]!.n)).toBe(1)
  })

  it('refuses someone who cannot deliver work in the first place', async () => {
    const id = await approvedSubmission()
    await expect(asUser(MEMBER, `select revoke_work_delivery('${id}');`)).rejects.toThrow(/not allowed/i)
    expect(await revokedAt(id)).toBeNull()
  })

  it('is safe to run twice', async () => {
    // A double click, or a retry after a dropped response.
    const id = await approvedSubmission()
    await asUser(OWNER, `select revoke_work_delivery('${id}');`)
    const first = await revokedAt(id)
    const again = await asUser<{ revoke_work_delivery: boolean }>(
      OWNER,
      `select revoke_work_delivery('${id}') as revoke_work_delivery;`,
    )
    expect(again.rows[0]!.revoke_work_delivery).toBe(true)
    expect(await revokedAt(id)).not.toBeNull()
    expect(first).not.toBeNull()
  })
})
