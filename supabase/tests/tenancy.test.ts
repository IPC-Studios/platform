import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import { beforeAll, describe, expect, it } from 'vitest'

/**
 * Migration + function regression tests, run against an in-process Postgres
 * (pglite). This validates DDL correctness and the register / auth-context /
 * plan-gate LOGIC.
 *
 * NOTE: pglite runs as a superuser, which BYPASSES RLS — so this suite does
 * NOT prove RLS enforcement. Enforcement is proven by the real-Postgres RLS
 * suite (runs when DATABASE_URL points at a Supabase/Postgres instance).
 */
const migDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'migrations')
const mig = (f: string) => readFileSync(join(migDir, f), 'utf8')

const OWNER = '11111111-1111-1111-1111-111111111111'

async function freshDb() {
  const db = new PGlite()
  // Shim the Supabase surface pglite lacks.
  await db.exec(`create schema if not exists auth;`)
  await db.exec(`create table auth.users (id uuid primary key default gen_random_uuid(), email text);`)
  await db.exec(
    `create or replace function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;`,
  )
  await db.exec(`create role authenticated;`)
  await db.exec(`create role anon;`)
  // Real migrations (0000 extensions are Supabase-only; core covers what we need here).
  await db.exec(mig('0001_tenancy_core.sql'))
  await db.exec(mig('0002_auth_functions.sql'))
  await db.exec(mig('0003_tenancy_rls.sql'))
  await db.exec(mig('0004_access_control.sql'))
  await db.exec(mig('0005_company_theme.sql'))
  await db.exec(mig('0006_projects_core.sql'))
  await db.exec(mig('0007_tasks_production.sql'))
  await db.exec(mig('0008_team_allocation.sql'))
  await db.exec(mig('0009_data_management.sql'))
  await db.exec(mig('0010_work_delivery.sql'))
  await db.exec(mig('0011_billing.sql'))
  return db
}

async function asUser(db: PGlite, uid: string) {
  await db.exec(`set request.jwt.claim.sub = '${uid}';`)
}

describe('tenancy migrations + functions', () => {
  let db: PGlite
  beforeAll(async () => {
    db = await freshDb()
    await db.exec(`insert into auth.users (id, email) values ('${OWNER}', 'owner@studio.test');`)
    await asUser(db, OWNER)
  })

  it('register_company_and_admin creates company + owner user', async () => {
    const r = await db.query<{ role: string; existing: boolean; company_id: string }>(
      `select * from register_company_and_admin('Acme Studio','Owner Name','9876543210');`,
    )
    expect(r.rows[0]?.role).toBe('super_admin')
    expect(r.rows[0]?.existing).toBe(false)
    expect(r.rows[0]?.company_id).toBeTruthy()
  })

  it('get_auth_context returns owner context', async () => {
    const r = await db.query<{ role: string; is_owner: boolean; profile_key: string | null }>(
      `select * from get_auth_context();`,
    )
    expect(r.rows[0]?.role).toBe('super_admin')
    expect(r.rows[0]?.is_owner).toBe(true)
    expect(r.rows[0]?.profile_key).toBeNull()
  })

  it('register is idempotent on the auth uid', async () => {
    const r = await db.query<{ existing: boolean }>(
      `select existing from register_company_and_admin('Dup','Dup');`,
    )
    expect(r.rows[0]?.existing).toBe(true)
  })

  it('plan gate is inactive with no expiry, active when in the future', async () => {
    const off = await db.query<{ active: boolean }>(
      `select is_company_plan_active(get_current_company_id()) as active;`,
    )
    expect(off.rows[0]?.active).toBe(false)

    await db.exec(`update companies set plan_expiry = now() + interval '30 days' where id = get_current_company_id();`)
    const on = await db.query<{ active: boolean }>(
      `select is_company_plan_active(get_current_company_id()) as active;`,
    )
    expect(on.rows[0]?.active).toBe(true)
  })

  it('a second auth user with no tenant gets an empty auth context', async () => {
    const other = '22222222-2222-2222-2222-222222222222'
    await db.exec(`insert into auth.users (id, email) values ('${other}', 'nobody@x.test');`)
    await asUser(db, other)
    const r = await db.query(`select * from get_auth_context();`)
    expect(r.rows.length).toBe(0)
  })
})

describe('access control (Phase 2)', () => {
  let db: PGlite
  const owner = OWNER
  const member = '33333333-3333-3333-3333-333333333333'

  beforeAll(async () => {
    db = await freshDb()
    await db.exec(
      `insert into auth.users (id, email) values ('${owner}','owner@s.test'),('${member}','member@s.test');`,
    )
    // Owner registers the studio, then adds a member (admin) to the same company.
    await asUser(db, owner)
    await db.query(`select register_company_and_admin('Studio','Owner');`)
    await db.exec(
      `insert into users (user_id, company_id, role, name, email)
       values ('${member}', get_current_company_id(), 'admin', 'Member', 'member@s.test');`,
    )
  })

  it('owner assigns a profile + override; it flows into the member auth context', async () => {
    await asUser(db, owner)
    await db.query(
      `select set_user_access('${member}', 'finance_manager',
         '[{"permission_key":"clients.edit","enabled":true}]'::jsonb);`,
    )

    // Read back as owner.
    const ga = await db.query<{ profile_key: string; overrides: unknown[] }>(
      `select * from get_user_access('${member}');`,
    )
    expect(ga.rows[0]?.profile_key).toBe('finance_manager')
    expect(ga.rows[0]?.overrides).toHaveLength(1)

    // The member's own auth context reflects it.
    await asUser(db, member)
    const ctx = await db.query<{ profile_key: string; overrides: { permission_key: string }[] }>(
      `select * from get_auth_context();`,
    )
    expect(ctx.rows[0]?.profile_key).toBe('finance_manager')
    expect(ctx.rows[0]?.overrides?.[0]?.permission_key).toBe('clients.edit')
  })

  it('a non-owner cannot call set_user_access', async () => {
    await asUser(db, member) // admin, not owner
    await expect(
      db.query(`select set_user_access('${owner}', 'photographer');`),
    ).rejects.toThrow(/owner/i)
  })

  it('clearing the profile (null) drops back to role defaults', async () => {
    await asUser(db, owner)
    await db.query(`select set_user_access('${member}', null, '[]'::jsonb);`)
    await asUser(db, member)
    const ctx = await db.query<{ profile_key: string | null }>(`select * from get_auth_context();`)
    expect(ctx.rows[0]?.profile_key).toBeNull()
  })
})

describe('projects core (Phase 4)', () => {
  let db: PGlite
  let clientId: string

  beforeAll(async () => {
    db = await freshDb()
    await db.exec(`insert into auth.users (id, email) values ('${OWNER}', 'owner@s.test');`)
    await asUser(db, OWNER)
    await db.query(`select register_company_and_admin('Studio','Owner');`)
    const c = await db.query<{ id: string }>(
      `insert into clients (company_id, name) values (get_current_company_id(), 'Wedding Co')
       returning id;`,
    )
    clientId = c.rows[0]!.id
  })

  async function totals(projectId: string) {
    const r = await db.query<{ additional_deliverables_cost: string; total_cost: string }>(
      `select additional_deliverables_cost, total_cost from projects where id = '${projectId}';`,
    )
    return {
      additional: Number(r.rows[0]!.additional_deliverables_cost),
      total: Number(r.rows[0]!.total_cost),
    }
  }

  it('create_project_with_details computes totals from qualifying deliverables only', async () => {
    const r = await db.query<{ id: string }>(
      `select create_project_with_details(
         '${clientId}', 'Sharma Wedding', 50000, 'active', true,
         '[
           {"title":"Album","is_additional_charge":true,"additional_charge_amount":5000},
           {"title":"Extra film","is_additional_charge":true,"additional_charge_amount":3000},
           {"title":"Internal cut","visibility_scope":"internal","is_additional_charge":true,"additional_charge_amount":9999},
           {"title":"Free teaser","is_additional_charge":false,"additional_charge_amount":9999}
         ]'::jsonb,
         '[{"amount":20000,"mode":"upi"}]'::jsonb
       ) as id;`,
    )
    const projectId = r.rows[0]!.id
    const t = await totals(projectId)
    expect(t.additional).toBe(8000) // 5000 + 3000 only
    expect(t.total).toBe(58000) // package 50000 + 8000

    const pay = await db.query<{ n: string }>(
      `select count(*) as n from received_payments where project_id = '${projectId}';`,
    )
    expect(Number(pay.rows[0]!.n)).toBe(1)
  })

  it('trigger keeps totals correct when a deliverable is added, edited, deleted', async () => {
    const r = await db.query<{ id: string }>(
      `select create_project_with_details('${clientId}','Edit Test', 10000) as id;`,
    )
    const p = r.rows[0]!.id
    expect((await totals(p)).total).toBe(10000)

    // add a qualifying deliverable
    await db.query(
      `insert into deliverables (company_id, project_id, title, is_additional_charge, additional_charge_amount)
       values (get_current_company_id(), '${p}', 'Drone', true, 4000);`,
    )
    expect(await totals(p)).toEqual({ additional: 4000, total: 14000 })

    // demote it to non-charge -> drops out
    await db.query(`update deliverables set is_additional_charge = false where project_id = '${p}';`)
    expect(await totals(p)).toEqual({ additional: 0, total: 10000 })

    // re-charge then delete -> back to base
    await db.query(
      `update deliverables set is_additional_charge = true, additional_charge_amount = 2500 where project_id = '${p}';`,
    )
    expect((await totals(p)).total).toBe(12500)
    await db.query(`delete from deliverables where project_id = '${p}';`)
    expect((await totals(p)).total).toBe(10000)
  })

  it('rejects a client from another studio', async () => {
    await expect(
      db.query(`select create_project_with_details('${OWNER}', 'Bad', 1000);`),
    ).rejects.toThrow(/client not in this studio/i)
  })
})

describe('tasks & production board (Phase 5)', () => {
  let db: PGlite
  let projectId: string

  beforeAll(async () => {
    db = await freshDb()
    await db.exec(`insert into auth.users (id, email) values ('${OWNER}', 'owner@s.test');`)
    await asUser(db, OWNER)
    await db.query(`select register_company_and_admin('Studio','Owner');`)
    const c = await db.query<{ id: string }>(
      `insert into clients (company_id, name) values (get_current_company_id(), 'C') returning id;`,
    )
    const r = await db.query<{ id: string }>(
      `select create_project_with_details('${c.rows[0]!.id}', 'Proj', 10000, 'active', false,
        '[{"title":"Album"},{"title":"Film"},{"title":"Teaser"}]'::jsonb) as id;`,
    )
    projectId = r.rows[0]!.id
  })

  it('generate_tasks_for_project_deliverables makes one task per deliverable', async () => {
    const ids = await db.query<{ id: string }>(
      `select generate_tasks_for_project_deliverables('${projectId}') as id;`,
    )
    expect(ids.rows).toHaveLength(3)

    // Idempotent-ish: re-running skips deliverables that already have a task.
    const again = await db.query(
      `select generate_tasks_for_project_deliverables('${projectId}') as id;`,
    )
    expect(again.rows).toHaveLength(0)

    const count = await db.query<{ n: string }>(
      `select count(*) as n from tasks where project_id = '${projectId}';`,
    )
    expect(Number(count.rows[0]!.n)).toBe(3)
  })

  it('board lane order persists and survives a re-read', async () => {
    const tasks = await db.query<{ id: string }>(
      `select id from tasks where project_id = '${projectId}' order by created_at;`,
    )
    const ids = tasks.rows.map((t) => t.id)
    // Save a specific order (reverse), as a drag would.
    const reversed = [...ids].reverse()
    await db.query(
      `select set_board_lane_order('default', 'to_do', array['${reversed.join("','")}']::uuid[]);`,
    )

    const order = await db.query<{ task_id: string; sort_order: number }>(
      `select task_id, sort_order from production_board_card_order
       where lane_key = 'to_do' order by sort_order;`,
    )
    expect(order.rows.map((o) => o.task_id)).toEqual(reversed)
    expect(order.rows.map((o) => o.sort_order)).toEqual([0, 1, 2])
  })

  it('employee can update status of their own task, not others', async () => {
    const emp = '55555555-5555-5555-5555-555555555555'
    await db.exec(`insert into auth.users (id, email) values ('${emp}', 'emp@s.test');`)
    await asUser(db, OWNER)
    await db.exec(
      `insert into users (user_id, company_id, role, name, email)
       values ('${emp}', get_current_company_id(), 'employee', 'Emp', 'emp@s.test');`,
    )
    const task = await db.query<{ id: string }>(
      `select id from tasks where project_id = '${projectId}' limit 1;`,
    )
    const taskId = task.rows[0]!.id
    await db.query(`select create_task_with_assignees(null, null, 'X') ;`) // unassigned control
    await db.exec(
      `insert into task_assignees (task_id, user_id, company_id)
       values ('${taskId}', '${emp}', get_current_company_id());`,
    )

    await asUser(db, emp)
    await db.query(`select update_my_task_status('${taskId}', 'completed');`)
    const t = await db.query<{ status: string }>(`select status from tasks where id = '${taskId}';`)
    expect(t.rows[0]!.status).toBe('completed')

    // A task not assigned to the employee is rejected.
    await asUser(db, OWNER)
    const other = await db.query<{ id: string }>(
      `select id from tasks where project_id = '${projectId}' and id <> '${taskId}' limit 1;`,
    )
    await asUser(db, emp)
    await expect(
      db.query(`select update_my_task_status('${other.rows[0]!.id}', 'completed');`),
    ).rejects.toThrow(/not your task/i)
  })
})

describe('team allocation — no double booking (Phase 6)', () => {
  let db: PGlite
  const member = '66666666-6666-6666-6666-666666666666'

  beforeAll(async () => {
    db = await freshDb()
    await db.exec(`insert into auth.users (id, email) values ('${OWNER}', 'owner@s.test');`)
    await asUser(db, OWNER)
    await db.query(`select register_company_and_admin('Studio','Owner');`)
    await db.exec(`insert into auth.users (id,email) values ('${member}','m@s.test');`)
    await db.exec(
      `insert into users (user_id, company_id, role, name, email)
       values ('${member}', get_current_company_id(), 'employee', 'Shooter', 'm@s.test');`,
    )
  })

  it('books a slot, then rejects an overlapping booking for the same member', async () => {
    await db.query(
      `select book_team_slot('${member}', null, 'Photographer',
        '2026-07-01T10:00:00Z', '2026-07-01T14:00:00Z', 5000);`,
    )
    await expect(
      db.query(
        `select book_team_slot('${member}', null, 'Photographer',
          '2026-07-01T12:00:00Z', '2026-07-01T16:00:00Z', 5000);`,
      ),
    ).rejects.toThrow(/double_booking/i)
  })

  it('allows a back-to-back booking (touching edges)', async () => {
    const r = await db.query<{ book_team_slot: string }>(
      `select book_team_slot('${member}', null, 'Photographer',
        '2026-07-01T14:00:00Z', '2026-07-01T16:00:00Z', 5000);`,
    )
    expect(r.rows[0]!.book_team_slot).toBeTruthy()
  })

  it('a released slot no longer blocks that window', async () => {
    // Release the 10-14 booking, then the overlapping 12-16 becomes bookable.
    await db.query(
      `select set_team_slot_status(id, 'released') from team_assignment_slots
       where start_at = '2026-07-01T10:00:00Z';`,
    )
    const r = await db.query<{ book_team_slot: string }>(
      `select book_team_slot('${member}', null, 'Editor',
        '2026-07-01T11:00:00Z', '2026-07-01T13:00:00Z', 3000);`,
    )
    expect(r.rows[0]!.book_team_slot).toBeTruthy()
  })
})

describe('data custody (Phase 7)', () => {
  let db: PGlite
  beforeAll(async () => {
    db = await freshDb()
    await db.exec(`insert into auth.users (id, email) values ('${OWNER}', 'owner@s.test');`)
    await asUser(db, OWNER)
    await db.query(`select register_company_and_admin('Studio','Owner');`)
  })

  it('tracks a card through primary + backup to verified with attribution', async () => {
    const loc = await db.query<{ id: string }>(
      `insert into storage_locations (company_id, name, kind)
       values (get_current_company_id(), 'RAID-1', 'nas') returning id;`,
    )
    const rec = await db.query<{ id: string }>(
      `insert into shoot_data_records (company_id, data_label, card_count, size_gb,
         primary_status, primary_location_id, copied_by_uid)
       values (get_current_company_id(), 'CF Card A', 2, 64.5, 'copied', '${loc.rows[0]!.id}', auth.uid())
       returning id;`,
    )
    const id = rec.rows[0]!.id

    // Verify primary only — record is not fully verified yet.
    await db.query(`select verify_data_record('${id}', 'primary');`)
    let row = await db.query<{ primary_status: string; verified_at: string | null }>(
      `select primary_status, verified_at from shoot_data_records where id = '${id}';`,
    )
    expect(row.rows[0]!.primary_status).toBe('verified')
    expect(row.rows[0]!.verified_at).toBeNull()

    // Copy + verify backup — now verified_at stamps.
    await db.query(`update shoot_data_records set backup_status = 'copied' where id = '${id}';`)
    await db.query(`select verify_data_record('${id}', 'backup');`)
    row = await db.query(
      `select primary_status, backup_status, verified_at, copied_by_uid from shoot_data_records where id = '${id}';`,
    )
    expect((row.rows[0] as { backup_status: string }).backup_status).toBe('verified')
    expect((row.rows[0] as { verified_at: string | null }).verified_at).not.toBeNull()
    expect((row.rows[0] as { copied_by_uid: string }).copied_by_uid).toBe(OWNER)
  })
})

describe('work submission -> review -> tokenised delivery (Phase 8)', () => {
  let db: PGlite
  beforeAll(async () => {
    db = await freshDb()
    await db.exec(`insert into auth.users (id, email) values ('${OWNER}', 'owner@s.test');`)
    await asUser(db, OWNER)
    await db.query(`select register_company_and_admin('Studio','Owner');`)
    await db.exec(
      `update companies set plan_expiry = now() + interval '30 days' where id = get_current_company_id();`,
    )
  })

  it('runs submit -> approve -> deliver, and the token resolves to the submission', async () => {
    const sub = await db.query<{ submit_work: string }>(
      `select submit_work(null, null, 'https://drive/x', 'first cut');`,
    )
    const subId = sub.rows[0]!.submit_work

    // Delivery is blocked until approved.
    await expect(db.query(`select deliver_work_to_client('${subId}');`)).rejects.toThrow(
      /must be approved/i,
    )

    await db.query(`select review_work('${subId}', true, 'looks good');`)
    const token = await db.query<{ deliver_work_to_client: string }>(
      `select deliver_work_to_client('${subId}', 'email', 168);`,
    )
    const raw = token.rows[0]!.deliver_work_to_client
    expect(raw).toBeTruthy()

    // Public resolution (anon path) returns the submission id.
    const resolved = await db.query<{ resolve_access_token: string }>(
      `select resolve_access_token('work_delivery', '${raw}');`,
    )
    expect(resolved.rows[0]!.resolve_access_token).toBe(subId)

    // A wrong token resolves to nothing.
    const bad = await db.query<{ resolve_access_token: string | null }>(
      `select resolve_access_token('work_delivery', 'not-a-real-token');`,
    )
    expect(bad.rows[0]!.resolve_access_token).toBeNull()

    // A delivery row was recorded.
    const del = await db.query<{ n: string }>(
      `select count(*) as n from team_work_client_deliveries where submission_id = '${subId}';`,
    )
    expect(Number(del.rows[0]!.n)).toBe(1)
  })

  it('consume_access_token is one-time', async () => {
    const sub = await db.query<{ submit_work: string }>(
      `select submit_work(null, null, 'https://drive/y');`,
    )
    const subId = sub.rows[0]!.submit_work
    await db.query(`select review_work('${subId}', true);`)
    const raw = (
      await db.query<{ deliver_work_to_client: string }>(
        `select deliver_work_to_client('${subId}');`,
      )
    ).rows[0]!.deliver_work_to_client

    const first = await db.query<{ consume_access_token: string | null }>(
      `select consume_access_token('work_delivery', '${raw}');`,
    )
    expect(first.rows[0]!.consume_access_token).toBe(subId)
    const second = await db.query<{ consume_access_token: string | null }>(
      `select consume_access_token('work_delivery', '${raw}');`,
    )
    expect(second.rows[0]!.consume_access_token).toBeNull()
  })
})

describe('billing & invoicing (Phase 9)', () => {
  let db: PGlite
  let clientId: string
  beforeAll(async () => {
    db = await freshDb()
    await db.exec(`insert into auth.users (id, email) values ('${OWNER}', 'owner@s.test');`)
    await asUser(db, OWNER)
    await db.query(`select register_company_and_admin('Studio','Owner');`)
    await db.exec(
      `update companies set plan_expiry = now() + interval '30 days', state = 'Maharashtra'
       where id = get_current_company_id();`,
    )
    const c = await db.query<{ id: string }>(
      `insert into clients (company_id, name) values (get_current_company_id(), 'C') returning id;`,
    )
    clientId = c.rows[0]!.id
  })

  it('assigns sequential invoice numbers and persists totals', async () => {
    const items = JSON.stringify([
      { description: 'Photography', quantity: 1, rate: 100000, amount: 100000, gst_rate: 18, taxable: 100000, cgst: 9000, sgst: 9000, igst: 0 },
    ])
    const r1 = await db.query<{ id: string; invoice_number: string }>(
      `select * from create_invoice('${clientId}', null, '27', current_date, null,
        100000, 0, 100000, 18000, 118000, '${items}'::jsonb, null);`,
    )
    expect(r1.rows[0]!.invoice_number).toBe('INV-0001')

    const r2 = await db.query<{ invoice_number: string }>(
      `select * from create_invoice('${clientId}', null, '27', current_date, null,
        100000, 0, 100000, 18000, 118000, '${items}'::jsonb, null);`,
    )
    expect(r2.rows[0]!.invoice_number).toBe('INV-0002')

    const inv = await db.query<{ total: string; balance_due: string; status: string }>(
      `select total, balance_due, status from invoices where id = '${r1.rows[0]!.id}';`,
    )
    expect(Number(inv.rows[0]!.total)).toBe(118000)
    expect(Number(inv.rows[0]!.balance_due)).toBe(118000)

    const it = await db.query<{ n: string }>(
      `select count(*) as n from invoice_items where invoice_id = '${r1.rows[0]!.id}';`,
    )
    expect(Number(it.rows[0]!.n)).toBe(1)
  })

  it('records payments and moves status partial -> paid', async () => {
    const items = JSON.stringify([
      { description: 'Album', quantity: 1, rate: 10000, amount: 10000, gst_rate: 12, taxable: 10000, cgst: 600, sgst: 600, igst: 0 },
    ])
    const inv = await db.query<{ id: string }>(
      `select id from create_invoice('${clientId}', null, '27', current_date, null,
        10000, 0, 10000, 1200, 11200, '${items}'::jsonb, null);`,
    )
    const id = inv.rows[0]!.id

    await db.query(`select record_invoice_payment('${id}', 5000, current_date, 'upi', 'A1');`)
    let row = await db.query<{ status: string; balance_due: string }>(
      `select status, balance_due from invoices where id = '${id}';`,
    )
    expect(row.rows[0]!.status).toBe('partial')
    expect(Number(row.rows[0]!.balance_due)).toBe(6200)

    await db.query(`select record_invoice_payment('${id}', 6200, current_date, 'cash', 'A2');`)
    row = await db.query(`select status, balance_due from invoices where id = '${id}';`)
    expect(row.rows[0]!.status).toBe('paid')
    expect(Number(row.rows[0]!.balance_due)).toBe(0)
  })
})
