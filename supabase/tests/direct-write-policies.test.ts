import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import { beforeAll, describe, expect, it } from 'vitest'

/**
 * The three direct writes 0139 unblocked, each of which failed differently —
 * which is why none of them looked like the same bug.
 *
 * Runs as `authenticated` with the bootstrap grants applied, because that is
 * the only configuration where RLS has a say. See work-submission-rls.test.ts
 * for the two ways this setup lies to you if you get it wrong.
 */
const migDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'migrations')

const OWNER = '11111111-1111-1111-1111-111111111111'
const COMPANY = '22222222-2222-2222-2222-222222222222'
const MEMBER = '33333333-3333-3333-3333-333333333333'
const VENDOR = '44444444-4444-4444-4444-444444444444'
const CLIENT = '55555555-5555-5555-5555-555555555555'
const PROJECT = '66666666-6666-6666-6666-666666666666'

let db: PGlite
let submissionId: string
let provisionedId: string

async function asUser<T>(uid: string, sql: string) {
  await db.exec(`set role authenticated;`)
  await db.exec(`set request.jwt.claim.sub = '${uid}';`)
  try {
    return await db.query<T>(sql)
  } finally {
    await db.exec(`reset role;`)
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

  for (const f of readdirSync(migDir).filter((x) => x.endsWith('.sql') && !x.startsWith('0000_')).sort()) {
    await db.exec(readFileSync(join(migDir, f), 'utf8'))
  }

  await db.exec(`insert into auth.users (id, email) values
    ('${OWNER}', 'o@s.test'), ('${MEMBER}', 'm@s.test'), ('${VENDOR}', 'v@s.test');`)
  await db.exec(`
    insert into companies (id, name, owner_user_id) values ('${COMPANY}', 'Studio', '${OWNER}');
    insert into users (user_id, company_id, role, name, email) values
      ('${OWNER}',  '${COMPANY}', 'super_admin', 'Owner',  'o@s.test'),
      ('${MEMBER}', '${COMPANY}', 'employee',    'Member', 'm@s.test'),
      ('${VENDOR}', '${COMPANY}', 'employee',    'Vendor', 'v@s.test');
    insert into platform_admins (user_id) values ('${VENDOR}');
    insert into clients (id, company_id, name) values ('${CLIENT}', '${COMPANY}', 'A Client');
    insert into projects (id, company_id, client_id, name) values ('${PROJECT}', '${COMPANY}', '${CLIENT}', 'Wedding');
  `)

  const r = await asUser<{ id: string }>(
    MEMBER,
    `insert into team_work_submissions (company_id, project_id, submitted_by, title, submission_link)
     values ('${COMPANY}', '${PROJECT}', '${MEMBER}', 'Haldi edit', 'https://example.test/a') returning id;`,
  )
  submissionId = r.rows[0]!.id
})

describe('editing a submission before review', () => {
  it('the submitter can fix a typo in the link', async () => {
    const r = await asUser<{ id: string }>(
      MEMBER,
      `update team_work_submissions set submission_link = 'https://example.test/fixed'
        where id = '${submissionId}' returning id;`,
    )
    expect(r.rows.length).toBe(1)
  })

  it('a manager can too', async () => {
    const r = await asUser<{ id: string }>(
      OWNER,
      `update team_work_submissions set notes = 'Checked' where id = '${submissionId}' returning id;`,
    )
    expect(r.rows.length).toBe(1)
  })

  it('and nobody can once it has been reviewed', async () => {
    await db.exec(`update team_work_submissions set status = 'approved' where id = '${submissionId}';`)
    // RLS filters the update rather than refusing it, so this is zero rows,
    // which is exactly what the route reads as "cannot edit".
    const r = await asUser<{ id: string }>(
      MEMBER,
      `update team_work_submissions set notes = 'too late' where id = '${submissionId}' returning id;`,
    )
    expect(r.rows.length).toBe(0)
    await db.exec(`update team_work_submissions set status = 'submitted' where id = '${submissionId}';`)
  })
})

describe('revoking a client delivery', () => {
  it('a manager can mark it revoked', async () => {
    await db.exec(`
      insert into team_work_client_deliveries (company_id, submission_id, channel)
      values ('${COMPANY}', '${submissionId}', 'whatsapp');`)
    const r = await asUser<{ id: string }>(
      OWNER,
      `update team_work_client_deliveries set revoked_at = now()
        where submission_id = '${submissionId}' returning id;`,
    )
    expect(r.rows.length).toBe(1)
  })

  it('a plain employee cannot', async () => {
    const r = await asUser<{ id: string }>(
      MEMBER,
      `update team_work_client_deliveries set revoked_at = null
        where submission_id = '${submissionId}' returning id;`,
    )
    expect(r.rows.length).toBe(0)
  })
})

describe('vendor-provisioned studios', () => {
  it('a platform admin can create one, and read the id back', async () => {
    // RETURNING is the route's own shape, and it needs a SELECT policy over the
    // new row on top of the INSERT one — companies_select_own covers only the
    // caller's OWN company, which a vendor provisioning someone else's is not.
    const r = await asUser<{ id: string }>(
      VENDOR,
      `insert into companies (name) values ('Provisioned Studio') returning id;`,
    )
    expect(r.rows.length).toBe(1)
    provisionedId = r.rows[0]!.id
  })

  it('and record who it was provisioned for', async () => {
    const r = await asUser<{ id: string }>(
      VENDOR,
      `insert into platform_studio_invites (company_id, email, name, invited_by)
       values ('${provisionedId}', 'newowner@example.test', 'New Owner', '${VENDOR}')
       returning id;`,
    )
    expect(r.rows.length).toBe(1)
  })

  it('the same invite twice is a no-op, not a second pending claim', async () => {
    await asUser(
      VENDOR,
      `insert into platform_studio_invites (company_id, email, name, invited_by)
       values ('${provisionedId}', 'NewOwner@example.test', 'New Owner', '${VENDOR}')
       on conflict do nothing;`,
    )
    const n = await db.query<{ n: number }>(
      `select count(*)::int as n from platform_studio_invites where company_id = '${provisionedId}';`,
    )
    expect(n.rows[0]!.n).toBe(1)
  })

  it('a studio owner cannot read who else was invited', async () => {
    const r = await asUser<{ n: number }>(
      OWNER,
      `select count(*)::int as n from platform_studio_invites;`,
    )
    expect(r.rows[0]!.n).toBe(0)
  })

  it('a studio owner cannot — that would be creating tenants', async () => {
    await expect(
      asUser(OWNER, `insert into companies (name) values ('Sneaky Studio');`),
    ).rejects.toThrow()
  })
})
