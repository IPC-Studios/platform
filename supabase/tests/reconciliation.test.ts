import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import { beforeAll, beforeEach, describe, expect, it } from 'vitest'

/**
 * The reconciliation report.
 *
 * Its job is to put two independent derivations of the same rupee side by
 * side, so a divergence is a column instead of two screens nobody compares.
 * That is how both money bugs of 2026-09-16 stayed hidden.
 *
 * Which means the report itself has to be right about arithmetic nobody can
 * eyeball. Every figure below is built from known amounts and checked against
 * a number worked out by hand in the test, not against the query.
 */
const migDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'migrations')

const OWNER = '11111111-1111-1111-1111-111111111111'
const CREW = '22222222-2222-2222-2222-222222222222'
const COMPANY = '33333333-3333-3333-3333-333333333333'
const CLIENT = '44444444-4444-4444-4444-444444444444'
const OTHER_CLIENT = '55555555-5555-5555-5555-555555555555'
const PROJECT = '66666666-6666-6666-6666-666666666666'
const SHOOT = '77777777-7777-7777-7777-777777777777'

let db: PGlite

const report = async () => {
  const r = await db.query<{ j: Record<string, Record<string, unknown>> }>(
    `select reconciliation_summary() as j;`,
  )
  return r.rows[0]!.j
}
const moneyIn = async () => (await report())['money_in']!
const moneyOut = async () => (await report())['money_out']!
const health = async () => (await report())['health']!
const n = (v: unknown) => Number(v ?? 0)

/** An invoice on the project, in a state that counts as billed. */
const invoice = async (total: number, status = 'sent') =>
  (
    await db.query<{ id: string }>(
      `insert into invoices (company_id, client_id, project_id, invoice_number, invoice_date,
                             subtotal, taxable, tax, total, status)
       values ('${COMPANY}', '${CLIENT}', '${PROJECT}', 'INV-${Math.random().toString(36).slice(2, 8)}',
               current_date, ${total}, ${total}, 0, ${total}, '${status}')
       returning id;`,
    )
  ).rows[0]!.id

const payment = async (amount: number, opts: { status?: string; cleared?: boolean; invoice?: string } = {}) =>
  db.exec(`insert into received_payments
             (company_id, project_id, client_id, invoice_id, amount, paid_on, status, cleared_at)
           values ('${COMPANY}', '${PROJECT}', '${CLIENT}',
                   ${opts.invoice ? `'${opts.invoice}'` : 'null'}, ${amount}, current_date,
                   '${opts.status ?? 'paid'}', ${opts.cleared ? 'now()' : 'null'});`)

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
  await db.exec(`insert into auth.users (id, email) values ('${OWNER}', 'o@s.test'), ('${CREW}', 'c@s.test');`)
  await db.exec(`
    insert into companies (id, name, owner_user_id) values ('${COMPANY}', 'Studio', '${OWNER}');
    insert into users (user_id, company_id, role, name, email) values
      ('${OWNER}', '${COMPANY}', 'super_admin', 'Owner', 'o@s.test'),
      ('${CREW}',  '${COMPANY}', 'employee',    'Crew',  'c@s.test');
    insert into clients (id, company_id, name) values
      ('${CLIENT}', '${COMPANY}', 'Mehta'), ('${OTHER_CLIENT}', '${COMPANY}', 'Nair');
    insert into projects (id, company_id, client_id, name, package_cost)
      values ('${PROJECT}', '${COMPANY}', '${CLIENT}', 'Mehta Wedding', 200000);
    insert into shoots (id, company_id, project_id, name, shoot_date)
      values ('${SHOOT}', '${COMPANY}', '${PROJECT}', 'Sangeet', current_date);
  `)
  await db.exec(`set request.jwt.claim.sub = '${OWNER}';`)
})

beforeEach(async () => {
  await db.exec(`delete from team_slot_settlements;`)
  await db.exec(`delete from team_assignment_slots;`)
  await db.exec(`delete from received_payments;`)
  await db.exec(`delete from invoice_items;`)
  await db.exec(`delete from invoices;`)
})

describe('money in', () => {
  it('counts a sent invoice, and ignores a draft or a cancelled one', async () => {
    await invoice(50000, 'sent')
    await invoice(30000, 'draft')
    await invoice(20000, 'cancelled')
    // A draft has been sent to nobody and a cancelled one withdrawn; neither
    // is money owed.
    expect(n((await moneyIn())['invoiced'])).toBe(50000)
  })

  it('shows work sold but never billed', async () => {
    // The project is worth ₹2,00,000 and only ₹50,000 has been invoiced.
    // Nothing else in the app surfaces this.
    await invoice(50000)
    expect(n((await moneyIn())['unbilled'])).toBe(150000)
  })

  it('shows what a client still owes on a bill they have been sent', async () => {
    const inv = await invoice(80000)
    await payment(30000, { invoice: inv })
    const m = await moneyIn()
    expect(n(m['invoiced'])).toBe(80000)
    expect(n(m['received'])).toBe(30000)
    expect(n(m['outstanding'])).toBe(50000)
  })

  it('separates money recorded from money confirmed in the bank', async () => {
    await payment(40000, { cleared: true })
    await payment(25000)
    const m = await moneyIn()
    expect(n(m['received'])).toBe(65000)
    expect(n(m['banked'])).toBe(40000)
    // The gap is the point: a cheque that never cleared lives here.
    expect(n(m['unbanked'])).toBe(25000)
  })

  it('does not count a pending payment as received or banked', async () => {
    await payment(40000, { status: 'pending' })
    const m = await moneyIn()
    expect(n(m['received'])).toBe(0)
    expect(n(m['banked'])).toBe(0)
  })

  it('never reports a negative difference', async () => {
    // Overpayment happens — a client pays a round number against a smaller
    // bill. It must not read as negative money owed.
    const inv = await invoice(10000)
    await payment(15000, { invoice: inv })
    expect(n((await moneyIn())['outstanding'])).toBe(0)
  })

  it('lists only the projects with something to answer for', async () => {
    // A fully billed, fully paid, fully banked project is noise on a page
    // whose whole job is to show differences.
    await invoice(200000)
    await payment(200000, { cleared: true })
    const m = await moneyIn()
    expect(m['projects']).toEqual([])
    expect(n(m['outstanding'])).toBe(0)
    expect(n(m['unbilled'])).toBe(0)
  })
})

describe('money out', () => {
  const slot = async (cost: number, status = 'booked') =>
    (
      await db.query<{ id: string }>(
        `insert into team_assignment_slots (company_id, user_id, shoot_id, service_name,
                                            start_at, end_at, estimated_cost, status, created_by)
         values ('${COMPANY}', '${CREW}', '${SHOOT}', 'Photographer',
                 now(), now() + interval '4 hours', ${cost}, '${status}', '${OWNER}')
         returning id;`,
      )
    ).rows[0]!.id

  const settle = async (slotId: string, amount: number, type = 'payment') =>
    db.exec(`insert into team_slot_settlements
               (company_id, slot_id, member_uid, amount_due, amount_paid, paid_date, entry_type)
             values ('${COMPANY}', '${slotId}', '${CREW}', 0, ${amount}, current_date, '${type}');`)

  it('owes what the booking is costed at', async () => {
    await slot(8000)
    const m = await moneyOut()
    expect(n(m['due'])).toBe(8000)
    expect(n(m['outstanding'])).toBe(8000)
  })

  it('owes nothing on a released or cancelled booking', async () => {
    await slot(8000, 'released')
    await slot(5000, 'cancelled')
    expect(n((await moneyOut())['due'])).toBe(0)
  })

  it('subtracts a reversal, because the ledger is signed', async () => {
    const s = await slot(10000)
    await settle(s, 10000)
    await settle(s, -4000, 'reversal')
    const m = await moneyOut()
    expect(n(m['settled'])).toBe(6000)
    expect(n(m['outstanding'])).toBe(4000)
  })

  it('flags paying someone more than the booking was costed at', async () => {
    const s = await slot(5000)
    await settle(s, 7000)
    const m = await moneyOut()
    expect(n(m['overpaid'])).toBe(2000)
    expect(n(m['outstanding'])).toBe(0)
  })

  it('prefers the final cost over the estimate once one is set', async () => {
    const s = await slot(5000)
    await db.exec(`update team_assignment_slots set final_cost = 9000 where id = '${s}';`)
    expect(n((await moneyOut())['due'])).toBe(9000)
  })
})

describe('health checks', () => {
  it('are all clear on a tidy studio', async () => {
    const h = await health()
    for (const k of Object.keys(h)) expect(n(h[k]), k).toBe(0)
  })

  it('notices an invoice marked paid that still has a balance', async () => {
    const inv = await invoice(50000)
    // Forced past the trigger, the way a bad migration or a direct edit would.
    await db.exec(`update invoices set status = 'paid', balance_due = 10000 where id = '${inv}';`)
    expect(n((await health())['invoices_paid_with_balance'])).toBe(1)
  })

  it('notices an unsent invoice that has somehow been paid against', async () => {
    const inv = await invoice(50000, 'draft')
    await db.exec(`update invoices set amount_paid = 5000 where id = '${inv}';`)
    expect(n((await health())['invoices_unpaid_but_settled'])).toBe(1)
  })

  it('notices money filed against a client who is not on the project', async () => {
    await db.exec(`insert into received_payments
                     (company_id, project_id, client_id, amount, paid_on, status)
                   values ('${COMPANY}', '${PROJECT}', '${OTHER_CLIENT}', 1000, current_date, 'paid');`)
    expect(n((await health())['payments_client_mismatch'])).toBe(1)
  })

  it('would notice the 0145 constraint being dropped', async () => {
    // This count can only be non-zero if received_payments_linked_check is
    // gone — which is exactly when someone needs telling.
    expect(n((await health())['payments_linked_to_nothing'])).toBe(0)
    await db.exec(`alter table received_payments drop constraint received_payments_linked_check;`)
    await db.exec(`insert into received_payments (company_id, amount, paid_on, status)
                   values ('${COMPANY}', 500, current_date, 'paid');`)
    expect(n((await health())['payments_linked_to_nothing'])).toBe(1)
    await db.exec(`delete from received_payments where project_id is null and invoice_id is null;`)
    await db.exec(`alter table received_payments add constraint received_payments_linked_check
                     check (project_id is not null or invoice_id is not null);`)
  })
})

describe('access', () => {
  it('is refused to someone with no live studio', async () => {
    await db.exec(`set request.jwt.claim.sub = '00000000-0000-0000-0000-000000000000';`)
    await expect(db.query(`select reconciliation_summary();`)).rejects.toThrow(/not allowed/i)
    await db.exec(`set request.jwt.claim.sub = '${OWNER}';`)
  })
})
