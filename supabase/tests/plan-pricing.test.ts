import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import { beforeAll, describe, expect, it } from 'vitest'

/**
 * The three plans the studio actually sells.
 *
 * `plans` was empty, so /settings/subscription honestly reported "No plans are
 * on offer yet" and no studio could renew. The prices come from the old app's
 * own seed. What these check is the part that is easy to get wrong: a 2-year
 * plan could not previously be stored at all (the interval check allowed only
 * monthly and yearly), and a plan whose duration is expressed in days has to
 * beat the interval when activation works out the new expiry -- otherwise a
 * ₹30,000 two-year purchase silently buys one year.
 */
const migDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'migrations')

const OWNER = '11111111-1111-1111-1111-111111111111'
const COMPANY = '22222222-2222-2222-2222-222222222222'

let db: PGlite

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
  `)
  await db.exec(`set request.jwt.claim.sub = '${OWNER}';`)
})

const plan = async (key: string) => {
  const r = await db.query<Record<string, unknown>>(`select * from plans where key = $1;`, [key])
  return r.rows[0]
}

describe('plan pricing', () => {
  it('offers exactly the three plans, in the order they should be read', async () => {
    const r = await db.query<{ key: string }>(
      `select key from plans where is_active order by sort_order, price;`,
    )
    expect(r.rows.map((x) => x.key)).toEqual(['ipc_monthly', 'ipc_yearly', 'ipc_2year'])
  })

  it('carries the old app’s prices', async () => {
    expect(Number((await plan('ipc_monthly'))!['price'])).toBe(1999)
    expect(Number((await plan('ipc_yearly'))!['price'])).toBe(18000)
    expect(Number((await plan('ipc_2year'))!['price'])).toBe(30000)
  })

  it('states a saving that matches the arithmetic', async () => {
    // A savings line nobody checked against the prices is how a card ends up
    // promising a discount the invoice does not give.
    const monthly = Number((await plan('ipc_monthly'))!['price'])
    const yearly = await plan('ipc_yearly')
    const twoYear = await plan('ipc_2year')
    expect(monthly * 12 - Number(yearly!['price'])).toBe(5988)
    expect(String(yearly!['savings_label'])).toContain('5,988')
    expect(monthly * 24 - Number(twoYear!['price'])).toBe(17976)
    expect(String(twoYear!['savings_label'])).toContain('17,976')
  })

  it('quotes a per-month figure that matches the price and the term', async () => {
    const yearly = await plan('ipc_yearly')
    expect(Number(yearly!['monthly_equivalent'])).toBe(Number(yearly!['price']) / 12)
    const twoYear = await plan('ipc_2year')
    expect(Number(twoYear!['monthly_equivalent'])).toBe(Number(twoYear!['price']) / 24)
  })

  it('can store a two-year interval at all', async () => {
    expect((await plan('ipc_2year'))!['billing_interval']).toBe('biennial')
  })

  it('extends a fresh account by the plan’s own duration, not its interval', async () => {
    // The trap: 'biennial' is not 'yearly', so an interval-driven expiry would
    // fall through to one month and sell two years for a thirty-day extension.
    const p = await plan('ipc_2year')
    const order = await db.query<{ id: string }>(
      `insert into payment_orders (company_id, plan_id, amount, status, created_by)
       values ($1, $2, 30000, 'created', $3) returning id;`,
      [COMPANY, p!['id'], OWNER],
    )
    const r = await db.query<{ duplicate: boolean; expires_at: string }>(
      `select * from activate_subscription($1::uuid, 'pay_test');`,
      [order.rows[0]!.id],
    )
    const days = Math.round((new Date(r.rows[0]!.expires_at).getTime() - Date.now()) / 86_400_000)
    expect(days).toBe(730)
  })

  it('re-running the seed updates rather than duplicating', async () => {
    // The whole suite applies every migration twice in the idempotency check.
    await db.exec(readFileSync(join(migDir, '0141_plan_pricing.sql'), 'utf8'))
    const r = await db.query<{ n: string }>(`select count(*) as n from plans;`)
    expect(Number(r.rows[0]!.n)).toBe(3)
  })
})
