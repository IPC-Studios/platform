import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import { beforeAll, beforeEach, describe, expect, it } from 'vitest'

/**
 * What happens to a quote after it is sent.
 *
 * A quote is the studio's promise of a price, and the client answers it from
 * a public link with no login. Three answers are possible — accept, decline,
 * and say nothing until the date passes — and each has to end with the quote
 * in a state the studio can act on, the lead's timeline saying what happened,
 * and the one-shot link spent.
 *
 * The third answer is the one nobody writes code for, so it is the one worth
 * testing hardest.
 */
const migDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'migrations')

const OWNER = '11111111-1111-1111-1111-111111111111'
const COMPANY = '22222222-2222-2222-2222-222222222222'

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
  await db.exec(`set request.jwt.claim.sub = '${OWNER}';`)
})



let seq = 0
const lead = async (name: string, assignee: string | null = null) =>
  (await one<{ id: string }>(`
    insert into crm_leads (company_id, name, phone, source, assigned_to)
    values ('${COMPANY}', '${name}', '98${400000 + ++seq}', 'instagram',
            ${assignee ? `'${assignee}'` : 'null'})
    returning id;`))!.id

/** A quote built the way the app builds it, so the number is the app's. */
const quoteFor = async (leadId: string, title: string, amount: number) =>
  (await one<{ id: string }>(`
    select id from create_quote(
      '${leadId}'::uuid, '${title}', null, 'Maharashtra', true,
      ${amount}, 0, ${amount}, 0, ${amount},
      '[{"description":"Package","quantity":1,"rate":${amount},"amount":${amount},
         "gst_rate":0,"taxable":${amount},"cgst":0,"sgst":0,"igst":0,"sort_order":1}]'::jsonb);`))!.id

/** Send it and hand back the raw token the client would get in the link. */
const sendQuote = async (quoteId: string) => {
  const raw = `tok-${quoteId}`
  await db.exec(`update crm_quotes set status = 'sent', sent_at = now() where id = '${quoteId}';`)
  await db.exec(`
    insert into access_tokens (company_id, purpose, subject_id, token_hash, expires_at)
    values ('${COMPANY}', 'quote_accept', '${quoteId}',
            encode(sha256(convert_to('${raw}', 'UTF8')), 'hex'), now() + interval '30 days');`)
  return raw
}

const statusOf = async (quoteId: string) =>
  (await one<{ status: string }>(`select status from crm_quotes where id = '${quoteId}';`))!.status

const timelineOf = async (leadId: string) =>
  (await q<{ note: string }>(`select note from crm_lead_events where lead_id = '${leadId}';`))
    .map((e) => e.note)
    .join(' | ')

beforeEach(async () => {
  await db.exec(`delete from crm_lead_events;`)
  await db.exec(`delete from crm_activities;`)
  await db.exec(`delete from notifications;`)
  await db.exec(`delete from access_tokens where purpose = 'quote_accept';`)
  await db.exec(`delete from crm_quote_items;`)
  await db.exec(`delete from crm_quotes;`)
  await db.exec(`delete from crm_leads;`)
})

describe('a quote after it goes out', () => {
  it('accepting it records who accepted, and what for', async () => {
    const id = await lead('Aarav Mehta')
    const quote = await quoteFor(id, 'Wedding', 180000)
    const raw = await sendQuote(quote)

    const ok = await one<{ accept_quote: boolean }>(
      `select accept_quote('${raw}', 'Aarav Mehta', 'aarav@example.test') as accept_quote;`,
    )
    expect(ok!.accept_quote).toBe(true)
    expect(await statusOf(quote)).toBe('accepted')

    const acc = await one<{ accepted_by_name: string; accepted_at: string | null }>(
      `select accepted_by_name, accepted_at from crm_quotes where id = '${quote}';`,
    )
    // Who said yes and when is the whole evidentiary value of a web accept.
    expect(acc!.accepted_by_name).toBe('Aarav Mehta')
    expect(acc!.accepted_at).not.toBeNull()
    expect(await timelineOf(id)).toMatch(/accepted/i)
  })

  it('accepting sets the deal value from the quote', async () => {
    const id = await lead('Aarav Mehta')
    const quote = await quoteFor(id, 'Wedding', 180000)
    await db.query(`select accept_quote('${await sendQuote(quote)}', 'Aarav');`)
    const l = await one<{ deal_value: string | null }>(
      `select deal_value from crm_leads where id = '${id}';`,
    )
    // Otherwise the forecast still shows whatever was guessed at enquiry time
    // while the client has agreed to a different number.
    expect(Number(l!.deal_value)).toBe(180000)
  })

  it('tells the person the lead is assigned to', async () => {
    const id = await lead('Aarav Mehta', OWNER)
    const quote = await quoteFor(id, 'Wedding', 50000)
    await db.query(`select accept_quote('${await sendQuote(quote)}', 'Aarav');`)
    const n = await q<{ title: string }>(
      `select title from notifications where recipient_uid = '${OWNER}';`,
    )
    // A quote accepted at midnight that nobody hears about is a booking the
    // studio finds out about days later.
    expect(n.map((x) => x.title).join(' ')).toMatch(/accepted/i)
  })

  it('the link only works once', async () => {
    const id = await lead('Aarav Mehta')
    const quote = await quoteFor(id, 'Wedding', 50000)
    const raw = await sendQuote(quote)
    await db.query(`select accept_quote('${raw}', 'Aarav');`)
    const again = await one<{ accept_quote: boolean }>(
      `select accept_quote('${raw}', 'Somebody Else') as accept_quote;`,
    )
    // A re-usable accept link is a quote anyone can re-accept from a forwarded
    // email, under any name.
    expect(again!.accept_quote).toBe(false)
  })

  it('a made-up token accepts nothing', async () => {
    const id = await lead('Aarav Mehta')
    const quote = await quoteFor(id, 'Wedding', 50000)
    await sendQuote(quote)
    const bad = await one<{ accept_quote: boolean }>(
      `select accept_quote('not-the-token', 'Chancer') as accept_quote;`,
    )
    expect(bad!.accept_quote).toBe(false)
    expect(await statusOf(quote)).toBe('sent')
  })

  it('declining records the reason on the quote and the lead', async () => {
    const id = await lead('Aarav Mehta')
    const quote = await quoteFor(id, 'Wedding', 180000)
    const raw = await sendQuote(quote)
    const ok = await one<{ decline_quote: boolean }>(
      `select decline_quote('${raw}', 'Went with another studio') as decline_quote;`,
    )
    expect(ok!.decline_quote).toBe(true)
    expect(await statusOf(quote)).toBe('declined')
    const d = await one<{ decline_reason: string }>(
      `select decline_reason from crm_quotes where id = '${quote}';`,
    )
    // The reason is the only thing a lost quote leaves behind that is worth
    // anything later.
    expect(d!.decline_reason).toBe('Went with another studio')
    expect(await timelineOf(id)).toMatch(/declined/i)
  })

  it('cannot be accepted after the client declined it', async () => {
    const id = await lead('Aarav Mehta')
    const quote = await quoteFor(id, 'Wedding', 50000)
    const raw = await sendQuote(quote)
    await db.query(`select decline_quote('${raw}', 'too much');`)
    const ok = await one<{ accept_quote: boolean }>(
      `select accept_quote('${raw}', 'Aarav') as accept_quote;`,
    )
    expect(ok!.accept_quote).toBe(false)
    expect(await statusOf(quote)).toBe('declined')
  })

  it('refuses a quote whose date has passed, and marks it expired', async () => {
    const id = await lead('Aarav Mehta')
    const quote = await quoteFor(id, 'Wedding', 50000)
    const raw = await sendQuote(quote)
    await db.exec(`update crm_quotes set valid_until = current_date - 1 where id = '${quote}';`)
    const ok = await one<{ accept_quote: boolean }>(
      `select accept_quote('${raw}', 'Aarav') as accept_quote;`,
    )
    // Honouring a lapsed price because the client clicked late is a discount
    // the studio never agreed to.
    expect(ok!.accept_quote).toBe(false)
    expect(await statusOf(quote)).toBe('expired')
  })

  /**
   * The answer nobody gives: silence.
   *
   * The sweep that catches this has existed since 0048 and ran nightly from
   * the API. What it never had was a test, a dry run, or a line on the lead
   * saying the quote had lapsed — so "does a quote the client ignored ever
   * close?" was answerable only by waiting a day and looking.
   */
  it('the nightly sweep expires a quote the client never answered', async () => {
    const id = await lead('Aarav Mehta')
    const quote = await quoteFor(id, 'Wedding', 50000)
    await sendQuote(quote)
    await db.exec(`update crm_quotes set valid_until = current_date - 3 where id = '${quote}';`)

    const s = (await one<{ j: Record<string, Record<string, number>> }>(
      `select run_crm_followup_cron(p_dry_run => false) as j;`,
    ))!.j
    expect(s['quotes']!['expired']).toBe(1)
    expect(await statusOf(quote)).toBe('expired')
    // And the lead says why, so the studio is not left guessing which of its
    // quotes went cold.
    expect(await timelineOf(id)).toMatch(/expired/i)
  })

  it('the sweep leaves live quotes and drafts alone', async () => {
    const id = await lead('Aarav Mehta')
    const live = await quoteFor(id, 'Live', 50000)
    await sendQuote(live)
    await db.exec(`update crm_quotes set valid_until = current_date + 7 where id = '${live}';`)
    const draft = await quoteFor(id, 'Draft', 1000)
    await db.exec(`update crm_quotes set valid_until = current_date - 9 where id = '${draft}';`)
    const openEnded = await quoteFor(id, 'No date', 2000)
    await sendQuote(openEnded)

    await db.query(`select run_crm_followup_cron(p_dry_run => false);`)
    expect(await statusOf(live)).toBe('sent')
    // A draft was never sent, so there is no promise to lapse — expiring it
    // would delete the studio's own unfinished work from the Draft list.
    expect(await statusOf(draft)).toBe('draft')
    // No valid_until means no expiry date, not "expires immediately".
    expect(await statusOf(openEnded)).toBe('sent')
  })

  it('a dry run counts what is due without expiring it', async () => {
    const id = await lead('Aarav Mehta')
    const quote = await quoteFor(id, 'Wedding', 50000)
    await sendQuote(quote)
    await db.exec(`update crm_quotes set valid_until = current_date - 3 where id = '${quote}';`)
    const s = (await one<{ j: Record<string, Record<string, number>> }>(
      `select run_crm_followup_cron(p_dry_run => true) as j;`,
    ))!.j
    expect(s['quotes']!['due']).toBe(1)
    expect(s['quotes']!['expired']).toBe(0)
    expect(await statusOf(quote)).toBe('sent')
  })
})
