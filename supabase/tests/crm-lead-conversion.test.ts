import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import { beforeAll, beforeEach, describe, expect, it } from 'vitest'

/**
 * Turning a lead into a paying client.
 *
 * This is the seam the whole CRM exists for, and the one place where a record
 * stops being a CRM row and becomes money. convert_lead_to_project has three
 * shapes: client only, client + project, and client + project built from a
 * quote. Each has to leave a trail back to the lead, or the studio loses the
 * answer to "where did this client come from" at the moment it converts.
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
const lead = async (name: string, extraCols = '', extraVals = '') =>
  (await one<{ id: string }>(`
    insert into crm_leads (company_id, name, phone, source${extraCols})
    values ('${COMPANY}', '${name}', '98${300000 + ++seq}', 'instagram'${extraVals})
    returning id;`))!.id

const convert = async (leadId: string, args = '') =>
  await one<{ client_id: string; project_id: string | null }>(
    `select * from convert_lead_to_project('${leadId}'::uuid${args});`,
  )

const quoteFor = async (leadId: string, title: string, items: [string, number, number][]) =>
  (await one<{ id: string }>(`
    select id from create_quote(
      '${leadId}'::uuid, '${title}', null, 'Maharashtra', true,
      ${items.reduce((n, [, qty, rate]) => n + qty * rate, 0)}, 0,
      ${items.reduce((n, [, qty, rate]) => n + qty * rate, 0)}, 0,
      ${items.reduce((n, [, qty, rate]) => n + qty * rate, 0)},
      '${JSON.stringify(
        items.map(([description, quantity, rate], i) => ({
          description,
          quantity,
          rate,
          amount: quantity * rate,
          gst_rate: 0,
          taxable: quantity * rate,
          cgst: 0,
          sgst: 0,
          igst: 0,
          sort_order: i + 1,
        })),
      )}'::jsonb);`))!.id

const WITH_PROJECT = `, null, '{}'::jsonb, '{"name":"Wedding"}'::jsonb`

beforeEach(async () => {
  await db.exec(`delete from crm_lead_events;`)
  await db.exec(`delete from crm_quote_items;`)
  await db.exec(`delete from crm_quotes;`)
  await db.exec(`delete from crm_leads;`)
  await db.exec(`delete from projects;`)
  await db.exec(`delete from clients;`)
})

describe('converting a lead', () => {
  it('creates the client and the project, and links the lead to both', async () => {
    const id = await lead('Aarav Mehta')
    const r = await convert(id, `, null, '{}'::jsonb, '{"name":"Aarav wedding","package_cost":250000}'::jsonb`)
    expect(r!.client_id).toBeTruthy()
    expect(r!.project_id).toBeTruthy()

    const l = await one<{ status: string; converted_project_id: string | null }>(
      `select status, converted_project_id from crm_leads where id = '${id}';`,
    )
    expect(l!.status).toBe('converted')
    // Without this the lead is marked won and points at nothing.
    expect(l!.converted_project_id).toBe(r!.project_id)

    const p = await one<{ client_id: string; total_cost: string }>(
      `select client_id, total_cost from projects where id = '${r!.project_id}';`,
    )
    expect(p!.client_id).toBe(r!.client_id)
    expect(Number(p!.total_cost)).toBe(250000)
  })

  it('carries the lead’s own details onto the client', async () => {
    const id = await lead('Aarav Mehta', `, email`, `, 'aarav@example.test'`)
    const r = await convert(id, WITH_PROJECT)
    const c = await one<{ name: string; email: string; phone: string }>(
      `select name, email, phone from clients where id = '${r!.client_id}';`,
    )
    // Retyping the client's details is how two records for one person start.
    expect(c!.name).toBe('Aarav Mehta')
    expect(c!.email).toBe('aarav@example.test')
    expect(c!.phone).toBeTruthy()
  })

  it('refuses to convert the same lead twice', async () => {
    const id = await lead('Aarav Mehta')
    await convert(id, WITH_PROJECT)
    // A second convert would make a second client and a second project for
    // one booking, and the studio would bill one of them.
    await expect(
      db.query(`select * from convert_lead_to_project('${id}'::uuid, null, '{}'::jsonb, '{"name":"Wedding"}'::jsonb);`),
    ).rejects.toThrow(/already converted/i)
    expect((await q(`select 1 from clients;`)).length).toBe(1)
  })

  it('will not convert a lead with no phone number', async () => {
    const id = (await one<{ id: string }>(`
      insert into crm_leads (company_id, name, source) values ('${COMPANY}', 'No Phone', 'manual')
      returning id;`))!.id
    // The phone is the client's identity in this product — a client without
    // one cannot be matched back to the enquiry or the invoice.
    await expect(
      db.query(`select * from convert_lead_to_project('${id}'::uuid, null, '{}'::jsonb, '{"name":"X"}'::jsonb);`),
    ).rejects.toThrow(/phone/i)
    expect((await q(`select 1 from clients;`)).length).toBe(0)
  })

  it('reuses an existing client instead of making a second one', async () => {
    const existing = (await one<{ id: string }>(`
      insert into clients (company_id, name, phone) values ('${COMPANY}', 'Aarav Mehta', '9800000001')
      returning id;`))!.id
    const id = await lead('Aarav Mehta')
    const r = await convert(id, `, '${existing}'::uuid, '{}'::jsonb, '{"name":"Wedding"}'::jsonb`)
    expect(r!.client_id).toBe(existing)
    expect((await q(`select 1 from clients;`)).length).toBe(1)
  })

  it('builds the project from the quote, line items and all', async () => {
    const id = await lead('Aarav Mehta')
    const quote = await quoteFor(id, 'Wedding package', [
      ['Candid photography', 1, 120000],
      ['Drone', 2, 30000],
    ])

    const r = await convert(id, `, null, '{}'::jsonb, null, '${quote}'::uuid`)
    const p = await one<{ name: string; total_cost: string }>(
      `select name, total_cost from projects where id = '${r!.project_id}';`,
    )
    // The quote the client agreed to IS the project's price. Re-entering it
    // by hand is how a project gets billed at a number nobody quoted.
    expect(Number(p!.total_cost)).toBe(180000)
    expect(p!.name).toBe('Wedding package')

    const items = await q<{ title: string }>(
      `select title from deliverables where project_id = '${r!.project_id}';`,
    )
    expect(items.map((i) => i.title).sort()).toEqual(['Candid photography', 'Drone'])
  })

  it('will not attach a quote belonging to another lead', async () => {
    const a = await lead('Aarav Mehta')
    const b = await lead('Diya Rao')
    const quote = await quoteFor(b, 'Diya package', [['Album', 1, 9000]])
    await expect(
      db.query(`select * from convert_lead_to_project('${a}'::uuid, null, '{}'::jsonb, null, '${quote}'::uuid);`),
    ).rejects.toThrow(/unknown quote/i)
  })

  it('writes the conversion onto the lead’s history', async () => {
    const id = await lead('Aarav Mehta')
    await convert(id, WITH_PROJECT)
    const events = await q<{ note: string }>(`select note from crm_lead_events where lead_id = '${id}';`)
    expect(events.map((e) => e.note).join(' ')).toMatch(/converted/i)
  })

  /**
   * Client-only convert: the lead is won, the project comes later.
   *
   * This path deliberately leaves converted_project_id null, so the lead has
   * to record the client some other way — and the "already converted" guard,
   * which tests converted_project_id, has to know about it too.
   */
  it('client-only convert still points at the client it created', async () => {
    const id = await lead('Aarav Mehta')
    const r = await convert(id)
    expect(r!.client_id).toBeTruthy()
    expect(r!.project_id).toBeNull()
    const l = await one<{ status: string; converted_client_id: string | null }>(
      `select status, converted_client_id from crm_leads where id = '${id}';`,
    )
    expect(l!.status).toBe('converted')
    expect(l!.converted_client_id).toBe(r!.client_id)
  })

  it('does not convert a client-only lead a second time', async () => {
    const id = await lead('Aarav Mehta')
    await convert(id)
    await expect(db.query(`select * from convert_lead_to_project('${id}'::uuid);`)).rejects.toThrow(
      /already converted/i,
    )
    expect((await q(`select 1 from clients;`)).length).toBe(1)
  })
})
