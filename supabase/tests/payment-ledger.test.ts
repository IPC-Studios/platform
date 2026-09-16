import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import { beforeAll, beforeEach, describe, expect, it } from 'vitest'

/**
 * One payment ledger, and an invoice that cannot disagree with it.
 *
 * There were two tables and nothing joined them: `record_invoice_payment()`
 * wrote `invoice_payments`, and every project and profit figure summed
 * `received_payments`. Money recorded against an invoice was invisible to the
 * project it belonged to, and money recorded against the project left the
 * invoice unpaid for ever.
 *
 * The rule these check is the one that makes it stay fixed: an invoice's
 * amount_paid, balance_due and status are DERIVED from the ledger by trigger.
 * There is no path that writes them directly, so no path can drift.
 */
const migDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'migrations')

const OWNER = '11111111-1111-1111-1111-111111111111'
const COMPANY = '22222222-2222-2222-2222-222222222222'
const CLIENT = '33333333-3333-3333-3333-333333333333'
const PROJECT = '44444444-4444-4444-4444-444444444444'

let db: PGlite
let invoiceId: string

const q = async <T>(sql: string) => (await db.query<T>(sql)).rows

const invoice = async () =>
  (await q<{ amount_paid: string; balance_due: string; status: string }>(
    `select amount_paid, balance_due, status from invoices where id = '${invoiceId}';`,
  ))[0]!

/** What the project page and every profit report read. */
const projectReceived = async () =>
  Number(
    (await q<{ received: string }>(
      `select received from project_financials where project_id = '${PROJECT}';`,
    ))[0]!.received,
  )

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
    insert into clients (id, company_id, name) values ('${CLIENT}', '${COMPANY}', 'Mehta');
    insert into projects (id, company_id, client_id, name, package_cost)
      values ('${PROJECT}', '${COMPANY}', '${CLIENT}', 'Mehta Wedding', 180000);
  `)
  await db.exec(`set request.jwt.claim.sub = '${OWNER}';`)
})

beforeEach(async () => {
  await db.exec(`delete from received_payments;`)
  await db.exec(`delete from invoices;`)
  const r = await q<{ id: string }>(`
    insert into invoices (company_id, client_id, project_id, invoice_number, invoice_date,
                          subtotal, taxable, tax, total, status)
    values ('${COMPANY}', '${CLIENT}', '${PROJECT}', 'INV-T1', current_date,
            180000, 180000, 0, 180000, 'sent')
    returning id;`)
  invoiceId = r[0]!.id
})

describe('the payment ledger', () => {
  it('a payment recorded on the INVOICE reaches the project', async () => {
    // The bug: this money used to land in invoice_payments, which no project
    // or profit figure has ever read.
    expect(await projectReceived()).toBe(0)
    await q(`select record_invoice_payment('${invoiceId}', 60000, current_date, 'upi', 'REF-1', null);`)

    expect(await projectReceived()).toBe(60000)
    const inv = await invoice()
    expect(Number(inv.amount_paid)).toBe(60000)
    expect(Number(inv.balance_due)).toBe(120000)
    expect(inv.status).toBe('partial')
  })

  it('a payment recorded on the PROJECT against an invoice settles it', async () => {
    // The other direction, which used to leave the invoice unpaid for ever.
    await db.exec(`
      insert into received_payments (company_id, project_id, client_id, invoice_id, amount, paid_on, status)
      values ('${COMPANY}', '${PROJECT}', '${CLIENT}', '${invoiceId}', 180000, current_date, 'paid');`)
    const inv = await invoice()
    expect(Number(inv.amount_paid)).toBe(180000)
    expect(Number(inv.balance_due)).toBe(0)
    expect(inv.status).toBe('paid')
    expect(await projectReceived()).toBe(180000)
  })

  it('the same money is counted once, not twice', async () => {
    // Both screens now write one row into one table, so a payment entered
    // from either place produces the same single figure.
    await q(`select record_invoice_payment('${invoiceId}', 50000, current_date, 'cash', null, null);`)
    expect(await projectReceived()).toBe(50000)
    expect(Number((await invoice()).amount_paid)).toBe(50000)
  })

  it('a pending payment is not money received, so it does not settle an invoice', async () => {
    // The payments screen calls this "what is still pending". An invoice
    // marked paid by a promise would be reporting money nobody has.
    await db.exec(`
      insert into received_payments (company_id, project_id, client_id, invoice_id, amount, paid_on, status)
      values ('${COMPANY}', '${PROJECT}', '${CLIENT}', '${invoiceId}', 180000, current_date, 'pending');`)
    const inv = await invoice()
    expect(Number(inv.amount_paid)).toBe(0)
    expect(inv.status).toBe('sent')
  })

  it('follows the money when a payment is edited', async () => {
    await q(`select record_invoice_payment('${invoiceId}', 60000, current_date, null, null, null);`)
    await db.exec(`update received_payments set amount = 180000 where invoice_id = '${invoiceId}';`)
    expect((await invoice()).status).toBe('paid')
    await db.exec(`update received_payments set status = 'pending' where invoice_id = '${invoiceId}';`)
    expect(Number((await invoice()).amount_paid)).toBe(0)
  })

  it('un-settles the invoice when the payment is deleted', async () => {
    // A mistaken payment removed must not leave the invoice reading "paid".
    await q(`select record_invoice_payment('${invoiceId}', 180000, current_date, null, null, null);`)
    expect((await invoice()).status).toBe('paid')
    await db.exec(`delete from received_payments where invoice_id = '${invoiceId}';`)
    const inv = await invoice()
    expect(Number(inv.amount_paid)).toBe(0)
    expect(Number(inv.balance_due)).toBe(180000)
    expect(inv.status).toBe('sent')
  })

  it('moves the total with the payment when it is reassigned to another invoice', async () => {
    const second = (
      await q<{ id: string }>(`
        insert into invoices (company_id, client_id, project_id, invoice_number, invoice_date,
                              subtotal, taxable, tax, total, status)
        values ('${COMPANY}', '${CLIENT}', '${PROJECT}', 'INV-T2', current_date, 50000, 50000, 0, 50000, 'sent')
        returning id;`)
    )[0]!.id
    await q(`select record_invoice_payment('${invoiceId}', 50000, current_date, null, null, null);`)
    await db.exec(`update received_payments set invoice_id = '${second}' where invoice_id = '${invoiceId}';`)
    // Recomputing only the new invoice would leave the old one overstated.
    expect(Number((await invoice()).amount_paid)).toBe(0)
    const s = await q<{ amount_paid: string }>(`select amount_paid from invoices where id = '${second}';`)
    expect(Number(s[0]!.amount_paid)).toBe(50000)
  })

  it('accepts a payment against an invoice that has no project', async () => {
    // invoices.project_id is optional and the form does not require it, so
    // received_payments.project_id had to stop being NOT NULL.
    const orphan = (
      await q<{ id: string }>(`
        insert into invoices (company_id, client_id, invoice_number, invoice_date,
                              subtotal, taxable, tax, total, status)
        values ('${COMPANY}', '${CLIENT}', 'INV-T3', current_date, 10000, 10000, 0, 10000, 'sent')
        returning id;`)
    )[0]!.id
    await q(`select record_invoice_payment('${orphan}', 10000, current_date, null, null, null);`)
    const r = await q<{ status: string; project_id: string | null }>(
      `select i.status, rp.project_id from invoices i
         join received_payments rp on rp.invoice_id = i.id where i.id = '${orphan}';`,
    )
    expect(r[0]!.status).toBe('paid')
    expect(r[0]!.project_id).toBeNull()
  })

  it('refuses money that belongs to nothing', async () => {
    await expect(
      db.query(`insert into received_payments (company_id, amount, paid_on, status)
                values ('${COMPANY}', 500, current_date, 'paid');`),
    ).rejects.toThrow(/received_payments_linked_check/i)
  })

  it('leaves a project-only payment alone', async () => {
    // Most payments are not against an invoice at all; those must still count
    // for the project and touch no invoice.
    await db.exec(`
      insert into received_payments (company_id, project_id, client_id, amount, paid_on, status)
      values ('${COMPANY}', '${PROJECT}', '${CLIENT}', 25000, current_date, 'paid');`)
    expect(await projectReceived()).toBe(25000)
    expect(Number((await invoice()).amount_paid)).toBe(0)
  })
})
