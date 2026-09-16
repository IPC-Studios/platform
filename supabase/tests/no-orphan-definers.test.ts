import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import { beforeAll, describe, expect, it } from 'vitest'

/**
 * No SECURITY DEFINER function is granted to users and then never called.
 *
 * Twice in one day this shape turned out to be a whole feature that had never
 * run: mark_absent_backstop() (so no studio ever had an absent day recorded)
 * and deliver_work_to_client() (so clients were handed the studio's own
 * internal link). A third sweep found five more that were simply superseded
 * and left behind — still granted, still privileged, covered by nothing, and
 * one of them writing to a second table that looked like the payout ledger.
 *
 * A definer function runs as its owner and bypasses RLS. One that nothing
 * calls is unreviewed privileged surface, and the likeliest way it gets used
 * is by someone wiring up the older of two paths by mistake.
 *
 * This reads the live catalog after every migration, so it also catches a
 * function that loses its last caller later.
 */
const migDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'migrations')
const apiDir = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'services', 'api', 'src')

/**
 * Called from somewhere other than the API.
 *
 * Two ways that happens. A trigger names its function in pg_trigger and
 * mentions it nowhere else, so a catalog lookup is the only way to see it —
 * leaving this out reported every trigger function in the schema as an
 * orphan. And one function can call another, which means searching each
 * body (`prosrc`) for the name.
 */
const SQL_CALLERS = `
  select p.proname as name
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.prosecdef
     and (
       exists (select 1 from pg_trigger t where t.tgfoid = p.oid)
       or exists (
         select 1 from pg_proc q
          join pg_namespace qn on qn.oid = q.pronamespace
         where qn.nspname = 'public' and q.oid <> p.oid
           and q.prosrc ilike '%' || p.proname || '(%'
       )
     )`

/** Granted to a role a request can actually arrive as. */
const GRANTED = `
  select distinct p.proname as name
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.prosecdef
     and (has_function_privilege('authenticated', p.oid, 'EXECUTE')
       or has_function_privilege('service_role', p.oid, 'EXECUTE')
       or has_function_privilege('anon', p.oid, 'EXECUTE'))`

let db: PGlite
let apiSource = ''

function readApi(dir: string): string {
  let out = ''
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name)
    if (entry.isDirectory()) out += readApi(p)
    else if (entry.name.endsWith('.ts')) out += readFileSync(p, 'utf8')
  }
  return out
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
  apiSource = readApi(apiDir)
})

describe('SECURITY DEFINER functions', () => {
  it('are all reachable: the API calls them, or another function does', async () => {
    const granted = (await db.query<{ name: string }>(GRANTED)).rows.map((r) => r.name)
    const internal = new Set((await db.query<{ name: string }>(SQL_CALLERS)).rows.map((r) => r.name))

    const orphans = granted
      .filter((name) => !internal.has(name))
      .filter((name) => !new RegExp(`\\b${name}\\b`).test(apiSource))
      .sort()

    // If this fails, the function is either a feature nobody can reach — wire
    // it up — or one that was superseded and should be dropped. Both have
    // happened; neither is something to add to an allowlist.
    expect(orphans).toEqual([])
  })

  it('the superseded payout path is gone, and the live one is not', async () => {
    const gone = await db.query<{ n: string }>(
      `select count(*)::text as n from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.proname in ('settle_payout', 'payout_balance');`,
    )
    expect(Number(gone.rows[0]!.n)).toBe(0)

    const live = await db.query<{ n: string }>(
      `select count(*)::text as n from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.proname = 'create_payout_settlement';`,
    )
    expect(Number(live.rows[0]!.n)).toBeGreaterThan(0)
  })

  it('says in the schema which of the two payout ledgers is real', async () => {
    // The names differ by one word. A comment is what stops the next person
    // recording a payment against the dead one.
    const c = await db.query<{ t: string; comment: string | null }>(
      `select c.relname as t, obj_description(c.oid) as comment
         from pg_class c join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public'
          and c.relname in ('team_payout_settlements', 'team_slot_settlements');`,
    )
    for (const row of c.rows) expect(row.comment ?? '').not.toBe('')
    expect(c.rows.find((r) => r.t === 'team_payout_settlements')!.comment).toMatch(/superseded/i)
  })
})
