import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import { beforeAll, describe, expect, it } from 'vitest'

/**
 * list_reminders, narrowed.
 *
 * The function has taken an entity type, a due range, an overdue-only flag
 * and a search term since 0107. The API router passed three of its eleven
 * arguments and the reminders board had no filter bar at all, so every one of
 * those was dead. These check the arguments the router now sends actually
 * move the list — a named-argument call against a function whose signature
 * has drifted fails loudly here rather than silently returning everything.
 */
const migDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'migrations')

const OWNER = '11111111-1111-1111-1111-111111111111'
const COMPANY = '22222222-2222-2222-2222-222222222222'
const PROJECT = '44444444-4444-4444-4444-444444444444'
const CLIENT = '55555555-5555-5555-5555-555555555555'

let db: PGlite

/** Call it the way the router does: by name, so a renamed parameter fails. */
const list = async (args: string) => {
  const r = await db.query<{ s: Record<string, unknown> }>(`select list_reminders(${args}) as s;`)
  return r.rows[0]!.s
}
const titles = (s: Record<string, unknown>) =>
  ((s['items'] as { title: string }[] | null) ?? []).map((i) => i.title).sort()

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

  await db.exec(`insert into auth.users (id, email) values ('${OWNER}', 'owner@s.test');`)
  await db.exec(`
    insert into companies (id, name, owner_user_id) values ('${COMPANY}', 'Studio', '${OWNER}');
    insert into users (user_id, company_id, role, name, email) values
      ('${OWNER}', '${COMPANY}', 'super_admin', 'Owner', 'owner@s.test');
    insert into clients (id, company_id, name) values ('${CLIENT}', '${COMPANY}', 'Mehta');
    insert into projects (id, company_id, client_id, name) values ('${PROJECT}', '${COMPANY}', '${CLIENT}', 'Mehta Wedding');
    insert into reminders (company_id, user_id, created_by, title, priority, status, entity_type, entity_id, due_at) values
      ('${COMPANY}', '${OWNER}', '${OWNER}', 'Late call',    'high',   'active', 'project', '${PROJECT}', now() - interval '3 days'),
      ('${COMPANY}', '${OWNER}', '${OWNER}', 'Call tomorrow','medium', 'active', 'project', '${PROJECT}', now() + interval '1 day'),
      ('${COMPANY}', '${OWNER}', '${OWNER}', 'Next month',   'low',    'active', 'custom',  null,         now() + interval '30 days'),
      ('${COMPANY}', '${OWNER}', '${OWNER}', 'Finished',     'low',    'completed',   'custom',  null,         now() - interval '1 day');
  `)
  await db.exec(`set request.jwt.claim.sub = '${OWNER}';`)
})

describe('list_reminders filters', () => {
  it('returns everything when nothing is asked for', async () => {
    expect(titles(await list('')).length).toBe(4)
  })

  it('narrows to a status', async () => {
    expect(titles(await list(`p_status => 'active'`))).toEqual(['Call tomorrow', 'Late call', 'Next month'])
  })

  it('narrows to a priority', async () => {
    expect(titles(await list(`p_priority => 'high'`))).toEqual(['Late call'])
  })

  it('narrows to what a reminder is attached to', async () => {
    expect(titles(await list(`p_entity_type => 'project'`))).toEqual(['Call tomorrow', 'Late call'])
  })

  it('narrows to a due range', async () => {
    const s = await list(`p_due_from => (now() - interval '7 days'), p_due_to => (now() + interval '7 days')`)
    expect(titles(s)).toEqual(['Call tomorrow', 'Finished', 'Late call'])
  })

  it('shows only what is past its time', async () => {
    // Anything already done is not still owed, whatever date is on it.
    expect(titles(await list(`p_overdue => true, p_status => 'active'`))).toEqual(['Late call'])
  })

  it('searches by title', async () => {
    expect(titles(await list(`p_search => 'tomorrow'`))).toEqual(['Call tomorrow'])
  })

  it('treats a blank search as no filter rather than a title of ""', async () => {
    expect(titles(await list(`p_search => '   '`)).length).toBe(4)
  })

  it('combines the filters the router sends together', async () => {
    const s = await list(`p_status => 'active', p_entity_type => 'project', p_overdue => true`)
    expect(titles(s)).toEqual(['Late call'])
  })

  it('has exactly one overload, so a named call is never ambiguous', async () => {
    const r = await db.query<{ n: string }>(
      `select count(*) as n from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.proname = 'list_reminders';`,
    )
    expect(Number(r.rows[0]!.n)).toBe(1)
  })
})
