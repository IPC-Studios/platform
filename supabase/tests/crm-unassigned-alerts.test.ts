import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import { beforeAll, beforeEach, describe, expect, it } from 'vitest'

/**
 * Who hears about a lead nobody owns.
 *
 * notifications.recipient_uid is not null, so every alert in the CRM used to
 * be written as `if assigned_to is not null then notify`. An unassigned lead
 * — which is every lead between arriving and being picked up, and the state
 * a neglected lead stays in — generated silence. A client accepting a quote
 * at midnight is exactly the event most likely to land on one.
 *
 * These check the alert reached a real person, not that a counter moved.
 */
const migDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'migrations')

const OWNER = '11111111-1111-1111-1111-111111111111'
const COMPANY = '22222222-2222-2222-2222-222222222222'
const STAFF = '55555555-5555-5555-5555-555555555555'

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
  await db.exec(`insert into auth.users (id, email) values ('${STAFF}', 's@s.test');`)
  await db.exec(`
    insert into users (user_id, company_id, role, name, email) values
      ('${STAFF}', '${COMPANY}', 'employee', 'Staffer', 's@s.test');`)
  await db.exec(`set request.jwt.claim.sub = '${OWNER}';`)
})




let seq = 0
const lead = async (name: string, assignee: string | null) =>
  (await one<{ id: string }>(`
    insert into crm_leads (company_id, name, phone, source, assigned_to)
    values ('${COMPANY}', '${name}', '98${600000 + ++seq}', 'instagram',
            ${assignee ? `'${assignee}'` : 'null'})
    returning id;`))!.id

const quoteFor = async (leadId: string, amount: number) =>
  (await one<{ id: string }>(`
    select id from create_quote(
      '${leadId}'::uuid, 'Wedding', null, 'Maharashtra', true,
      ${amount}, 0, ${amount}, 0, ${amount},
      '[{"description":"Package","quantity":1,"rate":${amount},"amount":${amount},
         "gst_rate":0,"taxable":${amount},"cgst":0,"sgst":0,"igst":0,"sort_order":1}]'::jsonb);`))!.id

const sendQuote = async (quoteId: string) => {
  const raw = `tok-${quoteId}`
  await db.exec(`update crm_quotes set status = 'sent', sent_at = now() where id = '${quoteId}';`)
  await db.exec(`
    insert into access_tokens (company_id, purpose, subject_id, token_hash, expires_at)
    values ('${COMPANY}', 'quote_accept', '${quoteId}',
            encode(sha256(convert_to('${raw}', 'UTF8')), 'hex'), now() + interval '30 days');`)
  return raw
}

/**
 * Everyone who was told, with what.
 *
 * Filtered by type on purpose: creating a lead also trips the seeded
 * workflows and the SLA sweep, both of which notify legitimately. Counting
 * every row would make these tests fail for reasons that are not the
 * behaviour under test.
 */
const alerts = async (who: string | null, type?: string) => {
  const where = [
    who ? `recipient_uid = '${who}'` : '',
    type ? `type = '${type}'` : '',
  ].filter(Boolean)
  return await q<{ recipient_uid: string; type: string; title: string }>(
    `select recipient_uid, type, title from notifications
      ${where.length ? `where ${where.join(' and ')}` : ''};`,
  )
}

const tick = async (dry = false) =>
  (await one<{ j: Record<string, number | Record<string, number>> }>(
    `select run_crm_followup_cron(p_dry_run => ${dry}) as j;`,
  ))!.j

beforeEach(async () => {
  await db.exec(`delete from notifications;`)
  await db.exec(`delete from crm_lead_cadences;`)
  await db.exec(`delete from crm_lead_events;`)
  await db.exec(`delete from crm_activities;`)
  await db.exec(`delete from access_tokens where purpose = 'quote_accept';`)
  await db.exec(`delete from crm_quote_items;`)
  await db.exec(`delete from crm_quotes;`)
  await db.exec(`delete from crm_leads;`)
  await db.exec(`delete from crm_cadence_steps;`)
  await db.exec(`delete from crm_cadences;`)
  await db.exec(`update users set status = 'active', deleted_at = null where company_id = '${COMPANY}';`)
})

describe('who gets told', () => {
  it('prefers the person the lead is assigned to', async () => {
    const to = await one<{ r: string | null }>(
      `select crm_alert_recipient('${COMPANY}'::uuid, '${STAFF}'::uuid) as r;`,
    )
    expect(to!.r).toBe(STAFF)
  })

  it('falls back to the owner when nobody is assigned', async () => {
    const to = await one<{ r: string | null }>(
      `select crm_alert_recipient('${COMPANY}'::uuid, null) as r;`,
    )
    expect(to!.r).toBe(OWNER)
  })

  it('skips an assignee who has left', async () => {
    await db.exec(`update users set status = 'inactive' where user_id = '${STAFF}';`)
    const to = await one<{ r: string | null }>(
      `select crm_alert_recipient('${COMPANY}'::uuid, '${STAFF}'::uuid) as r;`,
    )
    // Alerts addressed to a deactivated account are the same as no alerts,
    // except that the counters say somebody was told.
    expect(to!.r).toBe(OWNER)
  })

  it('skips a soft-deleted assignee too', async () => {
    await db.exec(`update users set deleted_at = now() where user_id = '${STAFF}';`)
    const to = await one<{ r: string | null }>(
      `select crm_alert_recipient('${COMPANY}'::uuid, '${STAFF}'::uuid) as r;`,
    )
    expect(to!.r).toBe(OWNER)
  })
})

describe('a quote answered on a lead nobody owns', () => {
  it('still tells the owner it was accepted', async () => {
    const id = await lead('Aarav Mehta', null)
    const raw = await sendQuote(await quoteFor(id, 180000))
    await db.query(`select accept_quote('${raw}', 'Aarav Mehta');`)
    const n = await alerts(OWNER, 'crm_quote')
    // The booking the studio would otherwise learn about by accident.
    expect(n.map((x) => x.title).join(' ')).toMatch(/accepted/i)
  })

  it('still tells the owner it was declined', async () => {
    const id = await lead('Aarav Mehta', null)
    const raw = await sendQuote(await quoteFor(id, 180000))
    await db.query(`select decline_quote('${raw}', 'Too expensive');`)
    const n = await alerts(OWNER, 'crm_quote')
    expect(n.map((x) => x.title).join(' ')).toMatch(/declined/i)
  })

  it('does not tell the owner when someone else owns the lead', async () => {
    const id = await lead('Aarav Mehta', STAFF)
    const raw = await sendQuote(await quoteFor(id, 50000))
    await db.query(`select accept_quote('${raw}', 'Aarav');`)
    // The fallback is a fallback. Copying the owner on every assigned lead
    // would make the owner's list useless within a week.
    expect((await alerts(STAFF, 'crm_quote')).length).toBe(1)
    expect((await alerts(OWNER, 'crm_quote')).length).toBe(0)
  })
})

describe('cadence steps and tasks on a lead nobody owns', () => {
  it('a due cadence step reaches the owner', async () => {
    const c = (await one<{ id: string }>(`
      insert into crm_cadences (company_id, name, is_active) values ('${COMPANY}', 'Chase', true)
      returning id;`))!.id
    await db.exec(`
      insert into crm_cadence_steps (company_id, cadence_id, step_no, day_offset, note)
      values ('${COMPANY}', '${c}', 1, 0, 'Ring them'), ('${COMPANY}', '${c}', 2, 3, 'Ring again');`)
    const id = await lead('Aarav Mehta', null)
    await db.query(`select start_lead_cadence('${id}'::uuid, '${c}'::uuid);`)
    await db.exec(`update crm_lead_cadences set next_at = now() - interval '1 minute' where lead_id = '${id}';`)

    await tick()
    const n = await alerts(OWNER, 'crm_cadence')
    // A cadence is a promise to keep chasing. On an unassigned lead it used
    // to advance through every step in silence.
    expect(n.length).toBe(1)
  })

  it('a task due on an unassigned lead reaches the owner', async () => {
    const id = await lead('Aarav Mehta', null)
    await db.exec(`
      insert into crm_activities (company_id, lead_id, type, direction, subject, started_at, due_at)
      values ('${COMPANY}', '${id}', 'task', 'out', 'Send the album proofs', now(), now() - interval '1 hour');`)
    await tick()
    const n = await alerts(OWNER, 'crm_task')
    expect(n.map((x) => x.title).join(' ')).toMatch(/album proofs/i)
  })
})

describe('overdue follow-ups nobody owns', () => {
  const overdue = async (n: number) => {
    for (let i = 0; i < n; i++) {
      const id = await lead(`Unowned ${i}`, null)
      await db.exec(`update crm_leads set follow_up_at = now() - interval '2 days' where id = '${id}';`)
    }
    // Creating the leads trips the seeded workflows; clear the decks so what
    // is counted below is what the sweep sent.
    await db.exec(`delete from notifications;`)
  }

  it('sends one digest, not one alert per lead', async () => {
    await overdue(5)
    const s = await tick()
    expect(s['unassigned']).toBe(5)
    const n = await alerts(OWNER, 'crm_overdue')
    // Five separate "follow-up overdue" alerts the owner cannot act on
    // individually is the same as none — they get scrolled past.
    expect(n.length).toBe(1)
    expect(n[0]!.title).toMatch(/5 overdue leads have nobody on them/i)
  })

  it('says it in the singular when there is one', async () => {
    await overdue(1)
    await tick()
    const n = await alerts(OWNER, 'crm_overdue')
    expect(n[0]!.title).toMatch(/1 overdue lead has nobody on it/i)
  })

  it('sends nothing when every overdue lead has an owner', async () => {
    const id = await lead('Aarav Mehta', STAFF)
    await db.exec(`update crm_leads set follow_up_at = now() - interval '2 days' where id = '${id}';`)
    const s = await tick()
    expect(s['unassigned']).toBe(0)
    expect((await alerts(OWNER, 'crm_overdue')).length).toBe(0)
    // The assignee still gets their own per-lead alert, as before.
    expect((await alerts(STAFF, 'crm_overdue')).length).toBe(1)
  })

  it('does not repeat the digest on the next run of the day', async () => {
    await overdue(3)
    await tick()
    await tick()
    // The cron runs hourly. A digest without a daily dedupe key would be
    // twenty-four identical lines by bedtime.
    expect((await alerts(OWNER, 'crm_overdue')).length).toBe(1)
  })

  it('a dry run counts them and tells nobody', async () => {
    await overdue(4)
    const s = await tick(true)
    expect(s['unassigned']).toBe(4)
    expect((await alerts(null, 'crm_overdue')).length).toBe(0)
  })
})
