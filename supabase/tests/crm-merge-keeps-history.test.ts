import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import { beforeAll, beforeEach, describe, expect, it } from 'vitest'

/**
 * What survives merging two duplicate leads.
 *
 * Merging is the highest data-loss risk in any CRM: two records become one,
 * and whatever was hanging off the loser has to go somewhere. Both merge paths
 * here (merge_leads from 0035, resolve_crm_duplicates from 0107) archive the
 * loser with merged_into set and append its notes — but neither says anything
 * about the calls logged against it, the quote sent from it, or the reminder
 * somebody set on it.
 *
 * These record what actually happens, because "the history is still in the
 * database" and "the studio can see the history" are different claims, and
 * only the second one matters to the person who merged.
 */
const migDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'migrations')

const OWNER = '11111111-1111-1111-1111-111111111111'
const COMPANY = '22222222-2222-2222-2222-222222222222'
const OTHER_CO = '33333333-3333-3333-3333-333333333333'
const FOREIGN_LEAD = '44444444-4444-4444-4444-444444444444'

let db: PGlite
const q = async <T>(sql: string) => (await db.query<T>(sql)).rows
const one = async <T>(sql: string) => (await q<T>(sql))[0]

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
  await db.exec(`insert into auth.users (id, email) values ('${OWNER}', 'o@s.test');`)
  await db.exec(`
    insert into companies (id, name, owner_user_id) values ('${COMPANY}', 'Studio', '${OWNER}');
    insert into users (user_id, company_id, role, name, email) values
      ('${OWNER}', '${COMPANY}', 'super_admin', 'Owner', 'o@s.test');
  `)
  // A second studio, built before the session claim is set so no tenancy
  // guard is in play while the fixture is created.
  await db.exec(`
    insert into companies (id, name, owner_user_id) values ('${OTHER_CO}', 'Other studio', '${OWNER}');
    insert into crm_leads (id, company_id, name, phone, source)
    values ('${FOREIGN_LEAD}', '${OTHER_CO}', 'Someone else', '9811111111', 'referral');
  `)
  await db.exec(`set request.jwt.claim.sub = '${OWNER}';`)
})

let seq = 0
const lead = async (name: string, notes: string | null = null) =>
  (await one<{ id: string }>(`
    insert into crm_leads (company_id, name, phone, source, notes)
    values ('${COMPANY}', '${name}', '98${200000 + ++seq}', 'referral',
            ${notes === null ? 'null' : `'${notes}'`})
    returning id;`))!.id

beforeEach(async () => {
  await db.exec(`delete from crm_activities;`)
  await db.exec(`delete from crm_lead_events;`)
  await db.exec(`delete from crm_workflow_enrollments;`)
  await db.exec(`delete from crm_leads where company_id = '${COMPANY}';`)
})

describe('merging two duplicates', () => {
  it('keeps the survivor and archives the loser, pointing back', async () => {
    const keep = await lead('Priya Sharma')
    const dupe = await lead('priya sharma')
    await db.query(`select merge_leads('${keep}'::uuid, array['${dupe}']::uuid[]);`)

    const s = await one<{ is_archived: boolean }>(`select is_archived from crm_leads where id = '${keep}';`)
    const d = await one<{ is_archived: boolean; merged_into: string }>(
      `select is_archived, merged_into from crm_leads where id = '${dupe}';`,
    )
    expect(s!.is_archived).toBe(false)
    expect(d!.is_archived).toBe(true)
    // The trail back matters: without it a merge is indistinguishable from
    // someone archiving a lead by hand.
    expect(d!.merged_into).toBe(keep)
  })

  it('carries the loser’s notes onto the survivor', async () => {
    const keep = await lead('Priya Sharma', 'wants candid')
    const dupe = await lead('priya sharma', 'budget 2L')
    await db.query(`select merge_leads('${keep}'::uuid, array['${dupe}']::uuid[]);`)
    const s = await one<{ notes: string }>(`select notes from crm_leads where id = '${keep}';`)
    expect(s!.notes).toContain('wants candid')
    expect(s!.notes).toContain('budget 2L')
  })

  /**
   * The one that decides whether a merge loses work.
   *
   * Activities stay pointed at the lead they were logged against. The survivor
   * does not inherit them, and the loser is archived — so a call logged on the
   * duplicate is no longer reachable from the record the studio kept.
   *
   * This test states the behaviour rather than asserting it is right: nothing
   * is destroyed, and re-pointing history is a product decision about whose
   * timeline a call belongs to. What it prevents is the behaviour changing by
   * accident in either direction.
   */
  it('leaves activities on the lead they were logged against', async () => {
    const keep = await lead('Priya Sharma')
    const dupe = await lead('priya sharma')
    await db.exec(`insert into crm_activities (company_id, lead_id, type, direction, subject, started_at)
                   values ('${COMPANY}', '${dupe}', 'call', 'out', 'Discussed the album', now());`)
    await db.query(`select merge_leads('${keep}'::uuid, array['${dupe}']::uuid[]);`)

    const onSurvivor = await q(`select 1 from crm_activities where lead_id = '${keep}';`)
    const onLoser = await q(`select 1 from crm_activities where lead_id = '${dupe}';`)
    expect(onSurvivor.length).toBe(0)
    expect(onLoser.length).toBe(1)

    // Which means: reachable only by following merged_into. If the drawer ever
    // shows a merged lead's history, this is the join it has to make.
    const reachable = await q(
      `select a.subject from crm_activities a
         join crm_leads l on l.id = a.lead_id
        where l.id = '${keep}' or l.merged_into = '${keep}';`,
    )
    expect(reachable.length).toBe(1)
  })

  it('refuses to merge a lead into itself', async () => {
    // Archiving the survivor would lose the lead entirely, so this raises
    // rather than quietly doing nothing.
    const keep = await lead('Priya Sharma')
    await expect(
      db.query(`select merge_leads('${keep}'::uuid, array['${keep}']::uuid[]);`),
    ).rejects.toThrow(/survivor cannot be in duplicates/i)
    const s = await one<{ is_archived: boolean }>(`select is_archived from crm_leads where id = '${keep}';`)
    expect(s!.is_archived).toBe(false)
  })

  it('can be undone, and the lead comes back', async () => {
    const keep = await lead('Priya Sharma')
    const dupe = await lead('priya sharma')
    await db.query(`select merge_leads('${keep}'::uuid, array['${dupe}']::uuid[]);`)
    // Takes the SURVIVOR's id and restores everything merged into it — the
    // undo is "un-merge this lead", not "restore that duplicate".
    const restored = await one<{ unmerge_leads: number }>(
      `select unmerge_leads('${keep}'::uuid) as unmerge_leads;`,
    )
    expect(restored!.unmerge_leads).toBe(1)
    const d = await one<{ is_archived: boolean; merged_into: string | null }>(
      `select is_archived, merged_into from crm_leads where id = '${dupe}';`,
    )
    expect(d!.is_archived).toBe(false)
    expect(d!.merged_into).toBeNull()
    // ...and the line merge appended to the survivor goes with it, or an
    // undone merge leaves the other lead's notes behind for ever.
    const s2 = await one<{ notes: string | null }>(`select notes from crm_leads where id = '${keep}';`)
    expect(s2!.notes ?? '').not.toContain('merged from')
  })

  it('records the merge on the survivor’s history', async () => {
    const keep = await lead('Priya Sharma')
    const dupe = await lead('priya sharma')
    await db.exec(`delete from crm_lead_events;`)
    await db.query(`select merge_leads('${keep}'::uuid, array['${dupe}']::uuid[]);`)
    const events = await q<{ note: string }>(
      `select note from crm_lead_events where lead_id = '${keep}';`,
    )
    // A merge that leaves no trace is a lead that silently changed shape.
    expect(events.map((e) => e.note).join(' ')).toMatch(/merge/i)
  })

  it('does not merge a lead belonging to another studio', async () => {
    const keep = await lead('Priya Sharma')
    const n = await one<{ merged: number }>(
      `select merge_leads('${keep}'::uuid, array['${FOREIGN_LEAD}']::uuid[]) as merged;`,
    )
    // It skips the stranger rather than raising, and — the part that matters —
    // says so: the returned count is 0, not 1. A function that reported a
    // merge it did not do would have the tab claim a duplicate was folded in.
    expect(n!.merged).toBe(0)
    const f = await one<{ is_archived: boolean; merged_into: string | null }>(
      `select is_archived, merged_into from crm_leads where id = '${FOREIGN_LEAD}';`,
    )
    expect(f!.is_archived).toBe(false)
    expect(f!.merged_into).toBeNull()
  })
})
