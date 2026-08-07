import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import { beforeAll, describe, expect, it } from 'vitest'

/**
 * Migration + function regression tests, run against an in-process Postgres
 * (pglite). This validates DDL correctness and the register / auth-context /
 * plan-gate LOGIC.
 *
 * NOTE: pglite runs as a superuser, which BYPASSES RLS — so this suite does
 * NOT prove RLS enforcement. Enforcement is proven by the real-Postgres RLS
 * suite (runs when DATABASE_URL points at a Supabase/Postgres instance).
 */
const migDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'migrations')
const mig = (f: string) => readFileSync(join(migDir, f), 'utf8')

const OWNER = '11111111-1111-1111-1111-111111111111'

async function freshDb() {
  const db = new PGlite()
  // Shim the Supabase surface pglite lacks.
  await db.exec(`create schema if not exists auth;`)
  await db.exec(`create table auth.users (id uuid primary key default gen_random_uuid(), email text);`)
  await db.exec(
    `create or replace function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;`,
  )
  await db.exec(`create role authenticated;`)
  await db.exec(`create role anon;`)
  // Real migrations (0000 extensions are Supabase-only; core covers what we need here).
  await db.exec(mig('0001_tenancy_core.sql'))
  await db.exec(mig('0002_auth_functions.sql'))
  await db.exec(mig('0003_tenancy_rls.sql'))
  return db
}

async function asUser(db: PGlite, uid: string) {
  await db.exec(`set request.jwt.claim.sub = '${uid}';`)
}

describe('tenancy migrations + functions', () => {
  let db: PGlite
  beforeAll(async () => {
    db = await freshDb()
    await db.exec(`insert into auth.users (id, email) values ('${OWNER}', 'owner@studio.test');`)
    await asUser(db, OWNER)
  })

  it('register_company_and_admin creates company + owner user', async () => {
    const r = await db.query<{ role: string; existing: boolean; company_id: string }>(
      `select * from register_company_and_admin('Acme Studio','Owner Name','9876543210');`,
    )
    expect(r.rows[0]?.role).toBe('super_admin')
    expect(r.rows[0]?.existing).toBe(false)
    expect(r.rows[0]?.company_id).toBeTruthy()
  })

  it('get_auth_context returns owner context', async () => {
    const r = await db.query<{ role: string; is_owner: boolean; profile_key: string | null }>(
      `select * from get_auth_context();`,
    )
    expect(r.rows[0]?.role).toBe('super_admin')
    expect(r.rows[0]?.is_owner).toBe(true)
    expect(r.rows[0]?.profile_key).toBeNull()
  })

  it('register is idempotent on the auth uid', async () => {
    const r = await db.query<{ existing: boolean }>(
      `select existing from register_company_and_admin('Dup','Dup');`,
    )
    expect(r.rows[0]?.existing).toBe(true)
  })

  it('plan gate is inactive with no expiry, active when in the future', async () => {
    const off = await db.query<{ active: boolean }>(
      `select is_company_plan_active(get_current_company_id()) as active;`,
    )
    expect(off.rows[0]?.active).toBe(false)

    await db.exec(`update companies set plan_expiry = now() + interval '30 days' where id = get_current_company_id();`)
    const on = await db.query<{ active: boolean }>(
      `select is_company_plan_active(get_current_company_id()) as active;`,
    )
    expect(on.rows[0]?.active).toBe(true)
  })

  it('a second auth user with no tenant gets an empty auth context', async () => {
    const other = '22222222-2222-2222-2222-222222222222'
    await db.exec(`insert into auth.users (id, email) values ('${other}', 'nobody@x.test');`)
    await asUser(db, other)
    const r = await db.query(`select * from get_auth_context();`)
    expect(r.rows.length).toBe(0)
  })
})
