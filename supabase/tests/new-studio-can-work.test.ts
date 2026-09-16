import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import { beforeAll, describe, expect, it } from 'vitest'

/**
 * A studio that signed up a minute ago can use the app.
 *
 * Feature tables gate their writes on `is_current_user_active()`, which
 * includes the plan gate; identity tables deliberately do not, so an expired
 * studio can still reach the subscription page and pay (0034). That split
 * means a registration which fails to open the gate produces a studio that
 * can read everything and write almost nothing — and the failure is a silent
 * empty result, not an error, on whichever screen is tried first.
 *
 * This reproduces what CI does: register through the real function, then
 * write as that user with RLS on.
 *
 * It was written to chase three expense-creation failures in rls-live.mjs,
 * and ruled the schema out — a studio registered a second ago writes fine.
 * The real cause was a revoked token in the test itself. The file stays
 * because the property is worth holding: the split between gated and ungated
 * tables is easy to get wrong in a migration, and getting it wrong locks a
 * new studio out of the product on its first day.
 */
const migDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'migrations')

const UID = '11111111-1111-1111-1111-111111111111'

let db: PGlite

async function asUser<T>(sql: string) {
  await db.exec(`set role authenticated;`)
  await db.exec(`set request.jwt.claim.sub = '${UID}';`)
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

  // Sign up exactly the way the API does — nothing hand-inserted.
  await db.exec(`insert into auth.users (id, email) values ('${UID}', 'fresh@studio.test');`)
  await asUser(`select * from register_company_and_admin('Fresh Studio', 'Owner', '9000000000');`)
})

describe('a newly registered studio', () => {
  it('registered itself, and owns its company', async () => {
    const r = await asUser<{ is_owner: boolean; role: string }>(`select * from get_auth_context();`)
    expect(r.rows[0]!.is_owner).toBe(true)
    expect(r.rows[0]!.role).toBe('super_admin')
  })

  it('has a live plan gate from the moment it signs up', async () => {
    // 0018 gives every new company an open-ended grandfathered period by
    // default. Without it a studio is plan-expired before it has done
    // anything, and every gated write refuses.
    const r = await db.query<{ active: boolean; gf: string | null }>(
      `select is_company_plan_active(id) as active, grandfathered_until::text as gf from companies;`,
    )
    expect(r.rows[0]!.gf).not.toBeNull()
    expect(r.rows[0]!.active).toBe(true)
  })

  it('passes the predicate every feature table writes behind', async () => {
    const r = await asUser<{ ok: boolean }>(`select is_current_user_active() as ok;`)
    expect(r.rows[0]!.ok).toBe(true)
  })

  it('can create a company expense', async () => {
    // What the three rls-live checks assert, at the layer that decides it.
    const r = await asUser<{ id: string }>(
      `insert into expenses (company_id, created_by, amount)
       select id, '${UID}', 2500 from companies returning id;`,
    )
    expect(r.rows).toHaveLength(1)
  })

  it('can create a client, which is gated differently', async () => {
    // Clients write behind company_id alone — no plan gate. Worth pinning
    // separately: if expenses ever fail while clients pass, the plan gate is
    // the first suspect; if both fail together, it is tenancy.
    const r = await asUser<{ id: string }>(
      `insert into clients (company_id, name) select id, 'Mehta' from companies returning id;`,
    )
    expect(r.rows).toHaveLength(1)
  })

  it('stops writing to a gated table once the plan lapses, but keeps its identity', async () => {
    await db.exec(`update companies set grandfathered_until = now() - interval '1 day';`)
    // RLS REFUSES an insert rather than filtering it away — unlike a select,
    // update or delete, which quietly return nothing. Expecting zero rows here
    // is how you write a test that never runs its own assertion.
    await expect(
      asUser(
        `insert into expenses (company_id, created_by, amount)
         select id, '${UID}', 100 from companies returning id;`,
      ),
    ).rejects.toThrow(/row-level security/i)
    // ...and can still read its own company, so the owner can go and pay.
    const identity = await asUser<{ n: string }>(`select count(*)::text as n from companies;`)
    expect(Number(identity.rows[0]!.n)).toBe(1)
    await db.exec(`update companies set grandfathered_until = now() + interval '10 years';`)
  })
})
