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
/** Same read, named for the tests that re-run a migration to prove it is idempotent. */
const readMig = mig

const OWNER = '11111111-1111-1111-1111-111111111111'

async function freshDb() {
  const db = new PGlite()
  // Shim the Supabase surface pglite lacks.
  await db.exec(`create schema if not exists auth;`)
  await db.exec(
    `create table auth.users (id uuid primary key default gen_random_uuid(), email text, encrypted_password text);`,
  )
  await db.exec(
    `create or replace function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;`,
  )
  await db.exec(`create role authenticated;`)
  await db.exec(`create role anon;`)
  await db.exec(`create role service_role;`)
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
  await db.exec(mig('0012_expenses_financials.sql'))
  await db.exec(mig('0013_crm.sql'))
  await db.exec(mig('0014_hr_attendance.sql'))
  await db.exec(mig('0015_notifications_jobs.sql'))
  await db.exec(mig('0016_subscription_platform.sql'))
  await db.exec(mig('0017_terms_templates.sql'))
  await db.exec(mig('0018_open_trial_by_default.sql'))
  await db.exec(mig('0019_platform_console.sql'))
  await db.exec(mig('0020_platform_ops.sql'))
  await db.exec(mig('0021_email_verification.sql'))
  await db.exec(mig('0022_password_reset.sql'))
  await db.exec(mig('0023_password_version.sql'))
  await db.exec(mig('0024_refresh_tokens.sql'))
  await db.exec(mig('0025_session_hardening.sql'))
  await db.exec(mig('0026_team_directory.sql'))
  await db.exec(mig('0027_theme_fonts.sql'))
  await db.exec(mig('0028_crm_followups.sql'))
  await db.exec(mig('0029_lead_sources.sql'))
  await db.exec(mig('0030_attendance_ops.sql'))
  await db.exec(mig('0031_task_bundles.sql'))
  await db.exec(mig('0032_crm_v2.sql'))
  await db.exec(mig('0033_auth_hardening.sql'))
  await db.exec(mig('0034_plan_gate_and_audit.sql'))
  await db.exec(mig('0035_crm_v3.sql'))
  await db.exec(mig('0036_crm_v4.sql'))
  await db.exec(mig('0038_shoot_details.sql'))
  await db.exec(mig('0039_deliverable_sets.sql'))
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

  it('plan gate is inactive with no live gate, active when in the future', async () => {
    // New studios get an open-ended grandfathered trial (0018); clear it to
    // test the raw gate logic.
    await db.exec(
      `update companies set grandfathered_until = null, plan_expiry = null, grace_until = null
       where id = get_current_company_id();`,
    )
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

  // Smoke-tests the hand-written router SQL (list JOIN + detail double jsonb_agg)
  // that replaced PostgREST embeds — catches column/shape typos without a live PG.
  it('router SQL: list joins client_name; detail nests deliverables + payments', async () => {
    const r = await db.query<{ id: string }>(
      `select create_project_with_details(
         '${clientId}', 'Smoke Wedding', 40000, 'active', true,
         '[{"title":"Album","is_additional_charge":true,"additional_charge_amount":6000}]'::jsonb,
         '[{"amount":15000,"mode":"upi","reference":"TXN1"}]'::jsonb
       ) as id;`,
    )
    const projectId = r.rows[0]!.id

    const listRow = await db.query<{ client_name: string; total_cost: string }>(
      `select p.id, p.name, cl.name as client_name, p.total_cost
       from projects p left join clients cl on cl.id = p.client_id
       where p.id = '${projectId}';`,
    )
    expect(listRow.rows[0]!.client_name).toBe('Wedding Co')

    const detail = await db.query<{ deliverables: unknown[]; payments: { amount: number }[] }>(
      `select p.id,
         coalesce((select jsonb_agg(to_jsonb(d) order by d.created_at)
                   from deliverables d where d.project_id = p.id), '[]'::jsonb) as deliverables,
         coalesce((select jsonb_agg(jsonb_build_object(
                     'id', rp.id, 'amount', rp.amount, 'paid_on', rp.paid_on,
                     'mode', rp.mode, 'reference', rp.reference) order by rp.paid_on)
                   from received_payments rp where rp.project_id = p.id), '[]'::jsonb) as payments
       from projects p where p.id = '${projectId}';`,
    )
    expect(detail.rows[0]!.deliverables).toHaveLength(1)
    expect(detail.rows[0]!.payments).toHaveLength(1)
    expect(Number(detail.rows[0]!.payments[0]!.amount)).toBe(15000)
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

describe('financials — profit view (Phase 10)', () => {
  let db: PGlite
  let projectId: string
  const member = '77777777-7777-7777-7777-777777777777'

  beforeAll(async () => {
    db = await freshDb()
    await db.exec(`insert into auth.users (id, email) values ('${OWNER}', 'owner@s.test');`)
    await asUser(db, OWNER)
    await db.query(`select register_company_and_admin('Studio','Owner');`)
    await db.exec(
      `update companies set plan_expiry = now() + interval '30 days' where id = get_current_company_id();`,
    )
    await db.exec(`insert into auth.users (id,email) values ('${member}','m@s.test');`)
    await db.exec(
      `insert into users (user_id, company_id, role, name, email)
       values ('${member}', get_current_company_id(), 'employee', 'Shooter', 'm@s.test');`,
    )
    const c = await db.query<{ id: string }>(
      `insert into clients (company_id, name) values (get_current_company_id(), 'C') returning id;`,
    )
    const r = await db.query<{ id: string }>(
      `select create_project_with_details('${c.rows[0]!.id}', 'Proj', 200000) as id;`,
    )
    projectId = r.rows[0]!.id
  })

  it('reproduces Gross Profit = revenue - direct team cost - project expenses', async () => {
    // A shoot + a booked slot (direct team cost) + a project expense.
    const shoot = await db.query<{ id: string }>(
      `insert into shoots (company_id, project_id, name) values (get_current_company_id(), '${projectId}', 'Day 1') returning id;`,
    )
    await db.query(
      `select book_team_slot('${member}', '${shoot.rows[0]!.id}', 'Photographer',
        '2026-08-01T04:00:00Z', '2026-08-01T12:00:00Z', 40000);`,
    )
    await db.exec(
      `insert into expenses (company_id, project_id, category, amount)
       values (get_current_company_id(), '${projectId}', 'Travel', 15000);`,
    )

    const f = await db.query<{ revenue: string; direct_team_cost: string; project_expenses: string }>(
      `select revenue, direct_team_cost, project_expenses from project_financials where project_id = '${projectId}';`,
    )
    const row = f.rows[0]!
    expect(Number(row.revenue)).toBe(200000)
    expect(Number(row.direct_team_cost)).toBe(40000)
    expect(Number(row.project_expenses)).toBe(15000)
    // gross = 200000 - 40000 - 15000 = 145000
    expect(Number(row.revenue) - Number(row.direct_team_cost) - Number(row.project_expenses)).toBe(145000)
  })

  it('a cancelled slot is excluded from direct team cost', async () => {
    await db.query(
      `select set_team_slot_status(id, 'cancelled') from team_assignment_slots
       where company_id = get_current_company_id();`,
    )
    const f = await db.query<{ direct_team_cost: string }>(
      `select direct_team_cost from project_financials where project_id = '${projectId}';`,
    )
    expect(Number(f.rows[0]!.direct_team_cost)).toBe(0)
  })
})

describe('CRM — capture, dedupe, auto-assign (Phase 11)', () => {
  let db: PGlite
  const a = '88888888-8888-8888-8888-888888888888'
  const b = '99999999-9999-9999-9999-999999999999'

  beforeAll(async () => {
    db = await freshDb()
    await db.exec(`insert into auth.users (id, email) values ('${OWNER}', 'owner@s.test');`)
    await asUser(db, OWNER)
    await db.query(`select register_company_and_admin('Studio','Owner');`)
    for (const [id, name] of [
      [a, 'Sales A'],
      [b, 'Sales B'],
    ]) {
      await db.exec(`insert into auth.users (id,email) values ('${id}','${id}@s.test');`)
      await db.exec(
        `insert into users (user_id, company_id, role, name, email)
         values ('${id}', get_current_company_id(), 'employee', '${name}', '${id}@s.test');`,
      )
      await db.exec(
        `insert into crm_distribution_rules (company_id, user_id) values (get_current_company_id(), '${id}');`,
      )
    }
    await db.exec(
      `insert into crm_webhook_sources (company_id, source_key, kind)
       values (get_current_company_id(), 'meta-page-1', 'meta');`,
    )
  })

  it('a Meta lead flows to an assigned CRM lead, balanced across the team', async () => {
    const l1 = await db.query<{ capture_lead: string }>(
      `select capture_lead('meta-page-1', 'Lead One', '9876500001', 'one@x.in',
        '{"ad":"summer"}'::jsonb);`,
    )
    const l2 = await db.query<{ capture_lead: string }>(
      `select capture_lead('meta-page-1', 'Lead Two', '9876500002');`,
    )
    const rows = await db.query<{ source: string; assigned_to: string; status: string }>(
      `select source, assigned_to, status from crm_leads order by created_at;`,
    )
    expect(rows.rows).toHaveLength(2)
    expect(rows.rows[0]!.source).toBe('facebook')
    expect(rows.rows[0]!.status).toBe('new')
    // Balanced: the two leads go to two different assignees.
    expect(rows.rows[0]!.assigned_to).not.toBe(rows.rows[1]!.assigned_to)
    expect(l1.rows[0]!.capture_lead).not.toBe(l2.rows[0]!.capture_lead)
  })

  it('dedupes on normalized phone (10-digit vs +91 form)', async () => {
    const first = await db.query<{ capture_lead: string }>(
      `select capture_lead('meta-page-1', 'Dup', '9876511111');`,
    )
    const dup = await db.query<{ capture_lead: string }>(
      `select capture_lead('meta-page-1', 'Dup Again', '+91 98765 11111');`,
    )
    expect(dup.rows[0]!.capture_lead).toBe(first.rows[0]!.capture_lead)
  })

  it('rejects an unknown source key', async () => {
    await expect(db.query(`select capture_lead('nope', 'X', '9000000000');`)).rejects.toThrow(
      /unknown or inactive source/i,
    )
  })
})

describe('HR — geo-fenced attendance + payout ledger (Phase 12)', () => {
  let db: PGlite
  const emp = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
  // Studio at Mumbai; a point ~50m away and one ~15km away.
  const STUDIO = { lat: 19.076, lng: 72.8777 }

  beforeAll(async () => {
    db = await freshDb()
    await db.exec(`insert into auth.users (id, email) values ('${OWNER}', 'owner@s.test');`)
    await asUser(db, OWNER)
    await db.query(`select register_company_and_admin('Studio','Owner');`)
    await db.exec(
      `update companies set plan_expiry = now() + interval '30 days' where id = get_current_company_id();`,
    )
    await db.exec(
      `insert into company_location (company_id, lat, lng, radius_m)
       values (get_current_company_id(), ${STUDIO.lat}, ${STUDIO.lng}, 150);`,
    )
    await db.exec(`insert into auth.users (id,email) values ('${emp}','emp@s.test');`)
    await db.exec(
      `insert into users (user_id, company_id, role, name, email)
       values ('${emp}', get_current_company_id(), 'employee', 'Emp', 'emp@s.test');`,
    )
  })

  it('checks in inside the fence and is blocked outside it', async () => {
    await asUser(db, emp)
    const ok = await db.query<{ check_in: string }>(`select check_in(19.0764, 72.8777);`) // ~44m
    expect(ok.rows[0]!.check_in).toBeTruthy()

    // Reset the day would need a new date; instead a far point on a fresh member.
    await expect(db.query(`select check_in(19.2, 72.9);`)).rejects.toThrow(/outside_fence/i)
  })

  it('absent backstop marks the un-checked-in owner absent', async () => {
    // The owner never checked in today → backstop marks them absent.
    await db.query(`select mark_absent_backstop();`)
    await asUser(db, OWNER)
    const rows = await db.query<{ status: string }>(
      `select status from attendance where user_id = '${OWNER}';`,
    )
    expect(rows.rows[0]?.status).toBe('absent')
    // The employee who checked in is NOT overwritten to absent.
    const e = await db.query<{ status: string }>(
      `select status from attendance where user_id = '${emp}';`,
    )
    expect(e.rows[0]?.status).toBe('present')
  })

  it('payout ledger balance = sum of credits and debits', async () => {
    await asUser(db, OWNER)
    await db.query(`select settle_payout('${emp}', 8000, 'credit', 'shoot-1');`)
    await db.query(`select settle_payout('${emp}', -3000, 'debit', 'advance');`)
    const bal = await db.query<{ payout_balance: string }>(`select payout_balance('${emp}');`)
    expect(Number(bal.rows[0]!.payout_balance)).toBe(5000)
  })

  it('a non-owner cannot settle payouts', async () => {
    await asUser(db, emp)
    await expect(db.query(`select settle_payout('${emp}', 1000, 'credit');`)).rejects.toThrow(
      /not allowed/i,
    )
  })
})

describe('notifications & idempotent cron (Phase 13)', () => {
  let db: PGlite
  beforeAll(async () => {
    db = await freshDb()
    await db.exec(`insert into auth.users (id, email) values ('${OWNER}', 'owner@s.test');`)
    await asUser(db, OWNER)
    await db.query(`select register_company_and_admin('Studio','Owner');`)
    await db.exec(
      `update companies set plan_expiry = now() + interval '30 days' where id = get_current_company_id();`,
    )
    // A due reminder + a future one.
    await db.exec(
      `insert into reminders (company_id, user_id, title, remind_at)
       values (get_current_company_id(), '${OWNER}', 'Call client', now() - interval '1 hour'),
              (get_current_company_id(), '${OWNER}', 'Later task', now() + interval '2 days');`,
    )
  })

  it('cron is idempotent on re-run and its result is queryable', async () => {
    const first = await db.query<{ run_reminder_cron: { reminders_due: number; notifications_created: number } }>(
      `select run_reminder_cron(false);`,
    )
    expect(first.rows[0]!.run_reminder_cron.reminders_due).toBe(1)
    expect(first.rows[0]!.run_reminder_cron.notifications_created).toBe(1)

    // Re-run: same due reminder, but the notification de-dupes -> 0 created.
    const second = await db.query<{ run_reminder_cron: { notifications_created: number } }>(
      `select run_reminder_cron(false);`,
    )
    expect(second.rows[0]!.run_reminder_cron.notifications_created).toBe(0)

    // Exactly one notification exists for the owner.
    const n = await db.query<{ n: string }>(
      `select count(*) as n from notifications where recipient_uid = '${OWNER}';`,
    )
    expect(Number(n.rows[0]!.n)).toBe(1)

    // Both runs are recorded and queryable.
    const runs = await db.query<{ n: string }>(
      `select count(*) as n from cron_runs where job_name = 'reminder_cron';`,
    )
    expect(Number(runs.rows[0]!.n)).toBe(2)
  })

  it('dry_run reports due work without creating notifications', async () => {
    const dry = await db.query<{ run_reminder_cron: { reminders_due: number; notifications_created: number; dry_run: boolean } }>(
      `select run_reminder_cron(true);`,
    )
    expect(dry.rows[0]!.run_reminder_cron.dry_run).toBe(true)
    expect(dry.rows[0]!.run_reminder_cron.notifications_created).toBe(0)
  })
})

describe('subscription — activation + replay safety (Phase 14)', () => {
  let db: PGlite
  let planId: string
  beforeAll(async () => {
    db = await freshDb()
    await db.exec(`insert into auth.users (id, email) values ('${OWNER}', 'owner@s.test');`)
    await asUser(db, OWNER)
    await db.query(`select register_company_and_admin('Studio','Owner');`)
    const p = await db.query<{ id: string }>(
      `insert into plans (key, name, price, billing_interval) values ('pro','Pro', 5000, 'monthly') returning id;`,
    )
    planId = p.rows[0]!.id
  })

  it('a paid order activates the plan; a replay changes nothing', async () => {
    const order = await db.query<{ order_id: string; amount: string }>(
      `select * from create_payment_order('${planId}');`,
    )
    // Server-side price + 18% GST: 5000 * 1.18 = 5900.
    expect(Number(order.rows[0]!.amount)).toBe(5900)
    const orderId = order.rows[0]!.order_id

    const act = await db.query<{ duplicate: boolean; expires_at: string }>(
      `select * from activate_subscription('${orderId}', 'pay_123');`,
    )
    expect(act.rows[0]!.duplicate).toBe(false)
    const expiry1 = act.rows[0]!.expires_at

    // Plan expiry advanced ~1 month; the tenant is now active.
    const active = await db.query<{ active: boolean }>(
      `select is_company_plan_active(get_current_company_id()) as active;`,
    )
    expect(active.rows[0]!.active).toBe(true)

    // Replay the SAME order -> duplicate, no new transaction, expiry unchanged.
    const replay = await db.query<{ duplicate: boolean; expires_at: string }>(
      `select * from activate_subscription('${orderId}', 'pay_123');`,
    )
    expect(replay.rows[0]!.duplicate).toBe(true)
    expect(new Date(replay.rows[0]!.expires_at).getTime()).toBe(new Date(expiry1).getTime())

    const txns = await db.query<{ n: string }>(
      `select count(*) as n from payment_transactions where order_id = '${orderId}';`,
    )
    expect(Number(txns.rows[0]!.n)).toBe(1)
  })

  it('a replayed webhook event is recorded only once', async () => {
    const first = await db.query<{ record_webhook_event: boolean }>(
      `select record_webhook_event('evt_abc', '{"x":1}'::jsonb);`,
    )
    expect(first.rows[0]!.record_webhook_event).toBe(true)
    const second = await db.query<{ record_webhook_event: boolean }>(
      `select record_webhook_event('evt_abc', '{"x":1}'::jsonb);`,
    )
    expect(second.rows[0]!.record_webhook_event).toBe(false)
  })
})

describe('terms acknowledgement via public link (Phase 15)', () => {
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

  it('client acknowledges terms via token and the evidence is recorded', async () => {
    const issued = await db.query<{ document_id: string; token: string }>(
      `select * from issue_terms_document(null, 'You agree to the terms.', null, 336);`,
    )
    const { document_id, token } = issued.rows[0]!

    // Public display works.
    const body = await db.query<{ get_terms_for_token: string }>(
      `select get_terms_for_token('${token}');`,
    )
    expect(body.rows[0]!.get_terms_for_token).toContain('agree to the terms')

    // Acknowledge with evidence.
    const ack = await db.query<{ acknowledge_terms: boolean }>(
      `select acknowledge_terms('${token}', 'Priya Sharma', 'priya@x.in', '1.2.3.4', 'Mozilla/5.0');`,
    )
    expect(ack.rows[0]!.acknowledge_terms).toBe(true)

    const doc = await db.query<{ acknowledged_by_name: string; acknowledged_ip: string; acknowledged_at: string | null }>(
      `select acknowledged_by_name, acknowledged_ip, acknowledged_at
       from project_terms_documents where id = '${document_id}';`,
    )
    expect(doc.rows[0]!.acknowledged_by_name).toBe('Priya Sharma')
    expect(doc.rows[0]!.acknowledged_ip).toBe('1.2.3.4')
    expect(doc.rows[0]!.acknowledged_at).not.toBeNull()

    // The token is one-time: a second acknowledgement fails.
    const again = await db.query<{ acknowledge_terms: boolean }>(
      `select acknowledge_terms('${token}', 'Someone Else');`,
    )
    expect(again.rows[0]!.acknowledge_terms).toBe(false)
  })
})

describe('platform console (Phase 14 follow-up)', () => {
  let db: PGlite
  const owner = OWNER
  const vendor = '44444444-4444-4444-4444-444444444444'

  beforeAll(async () => {
    db = await freshDb()
    await db.exec(
      `insert into auth.users (id, email) values ('${owner}','owner@s.test'),('${vendor}','vendor@ipc.test');`,
    )
    await asUser(db, owner)
    await db.query(`select register_company_and_admin('Studio A','Owner');`)
    // A second tenant, so the cross-tenant list has more than one row.
    await asUser(db, vendor)
    await db.query(`select register_company_and_admin('Studio B','Vendor');`)
  })

  it('a studio owner is NOT a platform admin and is refused', async () => {
    await asUser(db, owner)
    const flag = await db.query<{ is_platform_admin: boolean }>(`select * from get_auth_context();`)
    expect(flag.rows[0]?.is_platform_admin).toBe(false)
    await expect(db.query(`select * from platform_list_studios();`)).rejects.toThrow(/platform access/i)
    await expect(db.query(`select * from platform_usage_summary();`)).rejects.toThrow(/platform access/i)
  })

  it('an allowlisted platform admin sees every tenant, cross-tenant', async () => {
    await db.exec(`insert into platform_admins (user_id) values ('${vendor}');`)
    await asUser(db, vendor)

    const flag = await db.query<{ is_platform_admin: boolean }>(`select * from get_auth_context();`)
    expect(flag.rows[0]?.is_platform_admin).toBe(true)

    const studios = await db.query<{ name: string; owner_email: string; user_count: number }>(
      `select name, owner_email, user_count from platform_list_studios() order by name;`,
    )
    expect(studios.rows.map((r) => r.name)).toEqual(['Studio A', 'Studio B'])
    expect(studios.rows[0]?.owner_email).toBe('owner@s.test')

    const usage = await db.query<{ studio_count: number; active_studio_count: number; total_users: number }>(
      `select * from platform_usage_summary();`,
    )
    expect(Number(usage.rows[0]?.studio_count)).toBe(2)
    // Both new studios get an open-ended grandfathered trial (0018) → active.
    expect(Number(usage.rows[0]?.active_studio_count)).toBe(2)
    expect(Number(usage.rows[0]?.total_users)).toBe(2)
  })
})

describe('platform ops — plan mutations (Phase 14 follow-up)', () => {
  let db: PGlite
  const vendor = '44444444-4444-4444-4444-444444444444'
  const owner = OWNER
  let studioB: string

  beforeAll(async () => {
    db = await freshDb()
    await db.exec(
      `insert into auth.users (id, email) values ('${owner}','owner@s.test'),('${vendor}','vendor@ipc.test');`,
    )
    await asUser(db, vendor)
    const b = await db.query<{ company_id: string }>(
      `select company_id from register_company_and_admin('Studio B','Vendor');`,
    )
    studioB = b.rows[0]!.company_id
    await asUser(db, owner)
    await db.query(`select register_company_and_admin('Studio A','Owner');`)
  })

  async function gate(companyId: string) {
    const r = await db.query<{ gate: string }>(
      `select platform_plan_gate(plan_expiry, grandfathered_until, grace_until) as gate
       from companies where id = '${companyId}';`,
    )
    return r.rows[0]?.gate
  }

  it('a non-platform-admin owner is refused every op', async () => {
    await asUser(db, owner)
    await expect(db.query(`select platform_extend_plan('${studioB}', 12);`)).rejects.toThrow(/platform access/i)
    await expect(db.query(`select platform_expire_plan('${studioB}');`)).rejects.toThrow(/platform access/i)
    await expect(db.query(`select platform_grant_trial('${studioB}');`)).rejects.toThrow(/platform access/i)
  })

  it('platform admin extends, expires, and re-grants a trial', async () => {
    await db.exec(`insert into platform_admins (user_id) values ('${vendor}');`)
    await asUser(db, vendor)

    // Extend → plan_expiry in the future → active.
    const ext = await db.query<{ platform_extend_plan: string }>(`select platform_extend_plan('${studioB}', 12);`)
    expect(new Date(ext.rows[0]!.platform_extend_plan).getTime()).toBeGreaterThan(Date.now())
    expect(await gate(studioB)).toBe('active')

    // Expire → all gates cleared/past → expired.
    await db.query(`select platform_expire_plan('${studioB}');`)
    expect(await gate(studioB)).toBe('expired')

    // Grant trial → grandfathered.
    await db.query(`select platform_grant_trial('${studioB}');`)
    expect(await gate(studioB)).toBe('grandfathered')

    // Each mutation logged a billing_event.
    const ev = await db.query<{ n: number }>(
      `select count(*)::int as n from billing_events
       where company_id = '${studioB}' and kind like 'platform_%';`,
    )
    expect(ev.rows[0]!.n).toBe(3)
  })

  it('extend rejects an out-of-range month count', async () => {
    await asUser(db, vendor)
    await expect(db.query(`select platform_extend_plan('${studioB}', 0);`)).rejects.toThrow(/between 1 and 60/i)
  })
})

describe('email verification (0021)', () => {
  let db: PGlite
  const uid = '55555555-5555-5555-5555-555555555555'

  beforeAll(async () => {
    db = await freshDb()
    await db.exec(`insert into auth.users (id, email) values ('${uid}', 'verify@s.test');`)
  })

  it('issue -> consume flips the user to verified, one-time', async () => {
    // Newly inserted (post-migration) user starts unverified.
    const before = await db.query<{ v: boolean }>(
      `select email_verified as v from auth.users where id = '${uid}';`,
    )
    expect(before.rows[0]!.v).toBe(false)

    const issued = await db.query<{ token: string }>(
      `select issue_email_verification('${uid}') as token;`,
    )
    const token = issued.rows[0]!.token
    expect(token.length).toBeGreaterThan(20)

    const consumed = await db.query<{ uid: string | null }>(
      `select consume_email_verification('${token}') as uid;`,
    )
    expect(consumed.rows[0]!.uid).toBe(uid)

    const after = await db.query<{ v: boolean }>(
      `select email_verified as v from auth.users where id = '${uid}';`,
    )
    expect(after.rows[0]!.v).toBe(true)

    // Second use is rejected.
    const replay = await db.query<{ uid: string | null }>(
      `select consume_email_verification('${token}') as uid;`,
    )
    expect(replay.rows[0]!.uid).toBeNull()
  })

  it('a bad token returns null', async () => {
    const r = await db.query<{ uid: string | null }>(
      `select consume_email_verification('not-a-real-token') as uid;`,
    )
    expect(r.rows[0]!.uid).toBeNull()
  })
})

describe('password reset (0022)', () => {
  let db: PGlite
  const uid = '66666666-6666-6666-6666-666666666666'

  const issue = async () =>
    (await db.query<{ token: string }>(`select issue_password_reset('${uid}') as token;`)).rows[0]!
      .token

  const consume = async (raw: string, hash = 'argon2-hash-new') =>
    (
      await db.query<{ uid: string | null }>(
        `select consume_password_reset('${raw}', '${hash}') as uid;`,
      )
    ).rows[0]!.uid

  beforeAll(async () => {
    db = await freshDb()
    await db.exec(
      `insert into auth.users (id, email, encrypted_password) values ('${uid}', 'reset@s.test', 'argon2-hash-old');`,
    )
    // Simulate an account created before this migration: never had a reset.
    await db.exec(`update auth.users set email_verified = false where id = '${uid}';`)
  })

  it('consume swaps the password, verifies the email, and stamps the change', async () => {
    const token = await issue()
    expect(token.length).toBeGreaterThan(20)
    expect(await consume(token)).toBe(uid)

    const after = await db.query<{
      pw: string
      verified: boolean
      changed: string | null
    }>(
      `select encrypted_password as pw, email_verified as verified, password_changed_at as changed
         from auth.users where id = '${uid}';`,
    )
    expect(after.rows[0]!.pw).toBe('argon2-hash-new')
    // Completing a reset proves mailbox control.
    expect(after.rows[0]!.verified).toBe(true)
    expect(after.rows[0]!.changed).not.toBeNull()
  })

  it('a token is one-time', async () => {
    const token = await issue()
    expect(await consume(token, 'hash-a')).toBe(uid)
    expect(await consume(token, 'hash-b')).toBeNull()
    const pw = await db.query<{ pw: string }>(
      `select encrypted_password as pw from auth.users where id = '${uid}';`,
    )
    expect(pw.rows[0]!.pw).toBe('hash-a') // the replay did not overwrite
  })

  it('issuing a new token kills the previous one', async () => {
    const first = await issue()
    const second = await issue()
    expect(await consume(first, 'hash-first')).toBeNull()
    expect(await consume(second, 'hash-second')).toBe(uid)
  })

  it('an expired token is refused', async () => {
    const token = await issue()
    await db.exec(
      `update password_reset_tokens set expires_at = now() - interval '1 minute' where consumed_at is null;`,
    )
    expect(await consume(token)).toBeNull()
  })

  it('a bad token returns null', async () => {
    expect(await consume('not-a-real-token')).toBeNull()
  })

  it('each reset bumps password_version, stranding older tokens', async () => {
    const before = await db.query<{ v: number }>(
      `select password_version as v from auth.users where id = '${uid}';`,
    )
    expect(await consume(await issue())).toBe(uid)
    const after = await db.query<{ v: number }>(
      `select password_version as v from auth.users where id = '${uid}';`,
    )
    expect(after.rows[0]!.v).toBe(before.rows[0]!.v + 1)
  })

  it('get_auth_context exposes the reset stamp + version for session invalidation', async () => {
    const owner = '77777777-7777-7777-7777-777777777777'
    await db.exec(`insert into auth.users (id, email) values ('${owner}', 'ctx@s.test');`)
    await asUser(db, owner)
    await db.query(`select register_company_and_admin('Ctx Studio', 'Ctx Owner', null);`)

    const before = await db.query<{ password_changed_at: string | null; password_version: number }>(
      `select password_changed_at, password_version from get_auth_context();`,
    )
    expect(before.rows[0]!.password_changed_at).toBeNull()
    // A fresh account matches the default the API reads for claim-less tokens.
    expect(before.rows[0]!.password_version).toBe(0)

    const t = (await db.query<{ token: string }>(`select issue_password_reset('${owner}') as token;`))
      .rows[0]!.token
    await db.query(`select consume_password_reset('${t}', 'hash-ctx') as uid;`)

    const after = await db.query<{ password_changed_at: string | null; password_version: number }>(
      `select password_changed_at, password_version from get_auth_context();`,
    )
    expect(after.rows[0]!.password_changed_at).not.toBeNull()
    expect(after.rows[0]!.password_version).toBe(1)
  })
})

describe('refresh tokens (0024)', () => {
  let db: PGlite
  const uid = '88888888-8888-8888-8888-888888888888'

  const issue = async () =>
    (await db.query<{ token: string }>(`select issue_refresh_token('${uid}') as token;`)).rows[0]!
      .token

  const rotate = async (raw: string) =>
    (
      await db.query<{ user_id: string | null; token: string | null }>(
        `select * from rotate_refresh_token('${raw}');`,
      )
    ).rows[0]!

  // "Live" means usable: unrevoked AND unexpired. The revoke functions skip
  // already-expired rows, which cannot be presented anyway.
  const liveCount = async () =>
    (
      await db.query<{ n: number }>(
        `select count(*)::int as n from refresh_tokens
          where user_id = '${uid}' and revoked_at is null and expires_at > now();`,
      )
    ).rows[0]!.n

  beforeAll(async () => {
    db = await freshDb()
    await db.exec(`insert into auth.users (id, email) values ('${uid}', 'refresh@s.test');`)
  })

  it('rotation returns a new token and spends the old one', async () => {
    const first = await issue()
    const r = await rotate(first)
    expect(r.user_id).toBe(uid)
    expect(r.token).not.toBeNull()
    expect(r.token).not.toBe(first)

    // The successor works.
    const second = await rotate(r.token!)
    expect(second.user_id).toBe(uid)
  })

  it('the successor inherits the original expiry — refreshing cannot extend a session forever', async () => {
    const raw = await issue()
    await db.exec(
      `update refresh_tokens set expires_at = now() + interval '3 days'
        where consumed_at is null and revoked_at is null and user_id = '${uid}';`,
    )
    const before = await db.query<{ exp: string }>(
      `select expires_at as exp from refresh_tokens
        where token_hash = encode(sha256(convert_to('${raw}', 'UTF8')), 'hex');`,
    )
    const r = await rotate(raw)
    const after = await db.query<{ exp: string }>(
      `select expires_at as exp from refresh_tokens
        where token_hash = encode(sha256(convert_to('${r.token}', 'UTF8')), 'hex');`,
    )
    // Compared to the predecessor's exact timestamp, not to a window: minting a
    // fresh `now() + 30 days` would still land inside any day-granularity bound.
    expect(after.rows[0]!.exp).toEqual(before.rows[0]!.exp)
  })

  it('stale reuse revokes the whole family', async () => {
    const raw = await issue()
    const r = await rotate(raw)
    // Age the consumption past the race grace window.
    await db.exec(
      `update refresh_tokens set consumed_at = now() - interval '5 minutes' where consumed_at is not null;`,
    )
    const replay = await rotate(raw)
    expect(replay.user_id).toBeNull()

    // The successor handed out earlier is dead too — that is the point.
    const after = await rotate(r.token!)
    expect(after.user_id).toBeNull()
  })

  it('a same-moment double refresh does NOT kill the family (two tabs)', async () => {
    const raw = await issue()
    const r = await rotate(raw)
    const replay = await rotate(raw) // still inside the grace window
    expect(replay.user_id).toBeNull()
    // The winner's token survives.
    expect((await rotate(r.token!)).user_id).toBe(uid)
  })

  it('an expired or revoked token is refused', async () => {
    const expired = await issue()
    await db.exec(
      `update refresh_tokens set expires_at = now() - interval '1 minute'
        where token_hash = encode(sha256(convert_to('${expired}', 'UTF8')), 'hex');`,
    )
    expect((await rotate(expired)).user_id).toBeNull()

    const revoked = await issue()
    await db.query(`select revoke_refresh_family('${revoked}');`)
    expect((await rotate(revoked)).user_id).toBeNull()
  })

  it('revoke_all_sessions kills every family and bumps password_version', async () => {
    await issue()
    await issue()
    expect(await liveCount()).toBeGreaterThan(0)

    const before = await db.query<{ v: number }>(
      `select password_version as v from auth.users where id = '${uid}';`,
    )
    const bumped = await db.query<{ v: number }>(`select revoke_all_sessions('${uid}') as v;`)

    expect(await liveCount()).toBe(0)
    expect(bumped.rows[0]!.v).toBe(before.rows[0]!.v + 1)
  })
})

describe('team directory + invitations (0026)', () => {
  let db: PGlite
  const owner = '77777777-7777-7777-7777-777777777777'
  let companyId: string
  let roleId: string

  /** Insert a pending invitation and return its id. */
  const invite = async (email: string, raw: string) => {
    const r = await db.query<{ id: string }>(
      `insert into user_invitations (company_id, email, token_hash, role, pending_name,
         pending_phone, pending_salary, pending_engagement_type, pending_role_ids, expires_at)
       values ('${companyId}', '${email}',
         encode(sha256(convert_to('${raw}', 'UTF8')), 'hex'), 'employee', 'Ravi Kumar',
         '9876543210', 42000, 'freelancer', array['${roleId}']::uuid[], now() + interval '7 days')
       returning id;`,
    )
    return r.rows[0]!.id
  }

  const consume = async (raw: string, hash = 'argon2-invitee') =>
    (
      await db.query<{ uid: string | null }>(
        `select consume_user_invitation('${raw}', '${hash}') as uid;`,
      )
    ).rows[0]!.uid

  beforeAll(async () => {
    db = await freshDb()
    await db.exec(`insert into auth.users (id, email) values ('${owner}', 'owner@team.test');`)
    await asUser(db, owner)
    const c = await db.query<{ company_id: string }>(
      `select company_id from register_company_and_admin('Team Studio','Owner');`,
    )
    companyId = c.rows[0]!.company_id
    const r = await db.query<{ id: string }>(
      `insert into employee_roles (company_id, type_name, role_code)
       values ('${companyId}', 'Photographer', 'photographer') returning id;`,
    )
    roleId = r.rows[0]!.id
  })

  it('a directory-only member needs no email and no password', async () => {
    await db.exec(
      `insert into auth.users (id, email, encrypted_password)
       values ('88888888-8888-8888-8888-888888888888', null, null);`,
    )
    await db.exec(
      `insert into users (user_id, company_id, role, name, email, phone, engagement_type, login_enabled)
       values ('88888888-8888-8888-8888-888888888888', '${companyId}', 'employee',
               'Offline Crew', null, '9000000000', 'freelancer', false);`,
    )
    const r = await db.query<{ login_enabled: boolean; email: string | null }>(
      `select login_enabled, email from users where name = 'Offline Crew';`,
    )
    expect(r.rows[0]!.login_enabled).toBe(false)
    expect(r.rows[0]!.email).toBeNull()
  })

  it('engagement_type only accepts the two the wizard offers', async () => {
    await expect(
      db.exec(
        `update users set engagement_type = 'contractor' where user_id = '${owner}';`,
      ),
    ).rejects.toThrow()
  })

  it('peek shows the invite without leaking the salary', async () => {
    const raw = 'raw-token-peek'
    await invite('ravi@crew.test', raw)
    const r = await db.query<Record<string, unknown>>(
      `select * from peek_user_invitation('${raw}');`,
    )
    expect(r.rows[0]!.email).toBe('ravi@crew.test')
    expect(r.rows[0]!.company_name).toBe('Team Studio')
    expect(Object.keys(r.rows[0]!)).not.toContain('pending_salary')
  })

  it('consume creates the identity, the member row and their job roles', async () => {
    const raw = 'raw-token-consume'
    const id = await invite('meera@crew.test', raw)
    const uid = await consume(raw)
    expect(uid).toBeTruthy()

    const m = await db.query<{
      name: string
      company_id: string
      salary: number
      engagement_type: string
      status: string
    }>(`select name, company_id, salary, engagement_type, status from users where user_id = '${uid}';`)
    expect(m.rows[0]!.name).toBe('Ravi Kumar')
    expect(m.rows[0]!.company_id).toBe(companyId)
    expect(Number(m.rows[0]!.salary)).toBe(42000)
    expect(m.rows[0]!.engagement_type).toBe('freelancer')
    expect(m.rows[0]!.status).toBe('active')

    // Acceptance proves mailbox control, so the account is usable immediately.
    const a = await db.query<{ verified: boolean; pw: string }>(
      `select email_verified as verified, encrypted_password as pw from auth.users where id = '${uid}';`,
    )
    expect(a.rows[0]!.verified).toBe(true)
    expect(a.rows[0]!.pw).toBe('argon2-invitee')

    const roles = await db.query(
      `select 1 from employee_role_assignments where user_id = '${uid}' and role_id = '${roleId}';`,
    )
    expect(roles.rows.length).toBe(1)

    const inv = await db.query<{ accepted_at: string | null }>(
      `select accepted_at from user_invitations where id = '${id}';`,
    )
    expect(inv.rows[0]!.accepted_at).not.toBeNull()
  })

  it('a token is one-time, and a dead one peeks as nothing', async () => {
    const raw = 'raw-token-replay'
    await invite('once@crew.test', raw)
    expect(await consume(raw)).toBeTruthy()
    expect(await consume(raw)).toBeNull()
    const peek = await db.query(`select * from peek_user_invitation('${raw}');`)
    expect(peek.rows.length).toBe(0)
  })

  it('expired and revoked invitations are refused', async () => {
    const expired = 'raw-token-expired'
    const id = await invite('late@crew.test', expired)
    await db.exec(
      `update user_invitations set expires_at = now() - interval '1 day' where id = '${id}';`,
    )
    expect(await consume(expired)).toBeNull()

    const revoked = 'raw-token-revoked'
    const rid = await invite('gone@crew.test', revoked)
    await db.exec(`update user_invitations set revoked_at = now() where id = '${rid}';`)
    expect(await consume(revoked)).toBeNull()
  })

  it('only one live invitation per address, and revoking frees the address', async () => {
    await invite('dup@crew.test', 'raw-dup-1')
    await expect(invite('dup@crew.test', 'raw-dup-2')).rejects.toThrow()

    await db.exec(`update user_invitations set revoked_at = now() where email = 'dup@crew.test';`)
    await expect(invite('dup@crew.test', 'raw-dup-3')).resolves.toBeTruthy()
  })
})

describe('theme presets renamed (0027)', () => {
  let db: PGlite
  const owner = '99999999-9999-9999-9999-999999999999'

  beforeAll(async () => {
    db = await freshDb()
    await db.exec(`insert into auth.users (id, email) values ('${owner}', 'owner@theme.test');`)
    await asUser(db, owner)
    await db.query(`select register_company_and_admin('Theme Studio','Owner');`)
  })

  it('carries a studio on an old preset over to its named theme', async () => {
    // Re-run the mapping against a row that predates 0027, the way a live
    // database looks when the migration lands.
    await db.exec(
      `insert into company_theme_settings (company_id, preset_key)
       values (get_current_company_id(), 'amber')
       on conflict (company_id) do update set preset_key = 'amber';`,
    )
    await db.exec(readMig('0027_theme_fonts.sql'))

    const r = await db.query<{ preset_key: string; font_key: string | null }>(
      `select preset_key, font_key from company_theme_settings
        where company_id = get_current_company_id();`,
    )
    expect(r.rows[0]!.preset_key).toBe('luxury_gold')
    // No font means "whatever the theme ships with" — never a hardcoded face.
    expect(r.rows[0]!.font_key).toBeNull()
  })

  it('leaves a key it does not recognise alone', async () => {
    await db.exec(
      `update company_theme_settings set preset_key = 'ocean_blue'
        where company_id = get_current_company_id();`,
    )
    await db.exec(readMig('0027_theme_fonts.sql'))
    const r = await db.query<{ preset_key: string }>(
      `select preset_key from company_theme_settings where company_id = get_current_company_id();`,
    )
    expect(r.rows[0]!.preset_key).toBe('ocean_blue')
  })
})

describe('CRM manual lead entry (0028)', () => {
  let db: PGlite
  const owner = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'

  const add = async (name: string, phone: string) =>
    (
      await db.query<{ id: string }>(
        `select add_lead('${name}', '${phone}', null, 'enquiry', null, null) as id;`,
      )
    ).rows[0]!.id

  beforeAll(async () => {
    db = await freshDb()
    await db.exec(`insert into auth.users (id, email) values ('${owner}', 'owner@crm.test');`)
    await asUser(db, owner)
    await db.query(`select register_company_and_admin('CRM Studio','Owner');`)
  })

  it('creates a lead scoped to the calling company', async () => {
    const id = await add('Aanya', '9876500001')
    const r = await db.query<{ company_id: string; status: string; source: string }>(
      `select company_id, status, source from crm_leads where id = '${id}';`,
    )
    expect(r.rows[0]!.status).toBe('new')
    expect(r.rows[0]!.source).toBe('enquiry')
    expect(r.rows[0]!.company_id).toBe(
      (await db.query<{ id: string }>(`select get_current_company_id() as id;`)).rows[0]!.id,
    )
  })

  it('hands back the existing lead when the number is already known', async () => {
    // The same client ringing twice is one conversation, not two rows.
    const first = await add('Aanya', '9876500002')
    const again = await add('Aanya Sharma', '98765 00002')
    expect(again).toBe(first)
    const count = await db.query<{ n: number }>(
      `select count(*)::int as n from crm_leads where phone = '9876500002' or phone = '98765 00002';`,
    )
    expect(count.rows[0]!.n).toBe(1)
  })

  it('hands a new lead to the rota member carrying the least', async () => {
    const [a, b] = ['bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'cccccccc-cccc-cccc-cccc-cccccccccccc']
    for (const [i, uid] of [a!, b!].entries()) {
      await db.exec(`insert into auth.users (id, email) values ('${uid}', 'm${i}@crm.test');`)
      await db.exec(
        `insert into users (user_id, company_id, role, name, email)
         values ('${uid}', get_current_company_id(), 'employee', 'Member ${i}', 'm${i}@crm.test');`,
      )
      await db.exec(
        `insert into crm_distribution_rules (company_id, user_id, priority)
         values (get_current_company_id(), '${uid}', ${i});`,
      )
    }
    // First goes to whoever is empty; the second must not pile onto the same person.
    const one = await add('Lead one', '9000000001')
    const two = await add('Lead two', '9000000002')
    const owners = await db.query<{ assigned_to: string }>(
      `select assigned_to from crm_leads where id in ('${one}', '${two}');`,
    )
    const assigned = owners.rows.map((r) => r.assigned_to)
    expect(new Set(assigned).size).toBe(2)
  })

  it('accepts the proposal_sent stage the inbox filters on', async () => {
    const id = await add('Quoted', '9000000003')
    await db.exec(`update crm_leads set status = 'proposal_sent' where id = '${id}';`)
    const r = await db.query<{ status: string }>(`select status from crm_leads where id = '${id}';`)
    expect(r.rows[0]!.status).toBe('proposal_sent')
    await expect(
      db.exec(`update crm_leads set status = 'ghosted' where id = '${id}';`),
    ).rejects.toThrow()
  })
})

describe('lead sources (0029)', () => {
  let db: PGlite
  const owner = 'dddddddd-dddd-dddd-dddd-dddddddddddd'

  beforeAll(async () => {
    db = await freshDb()
    await db.exec(`insert into auth.users (id, email) values ('${owner}', 'owner@src.test');`)
    await asUser(db, owner)
    await db.query(`select register_company_and_admin('Source Studio','Owner');`)
  })

  it('mints a key nobody chose, scoped to the calling company', async () => {
    const r = await db.query<{ source_key: string; kind: string; label: string; company_id: string }>(
      `select * from create_lead_source('Website contact form', 'webform');`,
    )
    const row = r.rows[0]!
    expect(row.label).toBe('Website contact form')
    expect(row.kind).toBe('webform')
    // Long enough that guessing one is not worth anybody's afternoon.
    expect(row.source_key.length).toBeGreaterThan(50)
    expect(row.company_id).toBe(
      (await db.query<{ id: string }>(`select get_current_company_id() as id;`)).rows[0]!.id,
    )
  })

  it('refuses a kind the webhook cannot serve', async () => {
    await expect(db.query(`select * from create_lead_source('Carrier pigeon', 'pigeon');`)).rejects.toThrow()
  })

  it('records which source a captured lead came through', async () => {
    // 'facebook' vs 'webform' cannot tell two campaigns apart, and "which
    // campaign is working" is the only question this page exists to answer.
    const a = (
      await db.query<{ source_key: string }>(`select * from create_lead_source('Campaign A', 'meta');`)
    ).rows[0]!.source_key
    const b = (
      await db.query<{ source_key: string }>(`select * from create_lead_source('Campaign B', 'meta');`)
    ).rows[0]!.source_key

    await db.query(`select capture_lead('${a}', 'From A', '9000000011', null, '{}'::jsonb);`)
    await db.query(`select capture_lead('${b}', 'From B', '9000000012', null, '{}'::jsonb);`)

    const rows = await db.query<{ name: string; source: string; source_key: string }>(
      `select name, source, source_key from crm_leads where source_key in ('${a}', '${b}') order by name;`,
    )
    expect(rows.rows.map((r) => r.source)).toEqual(['facebook', 'facebook'])
    expect(rows.rows[0]!.source_key).toBe(a)
    expect(rows.rows[1]!.source_key).toBe(b)
  })

  it('stops accepting leads once a source is paused', async () => {
    const key = (
      await db.query<{ source_key: string }>(`select * from create_lead_source('Old form', 'webform');`)
    ).rows[0]!.source_key
    await db.exec(`update crm_webhook_sources set is_active = false where source_key = '${key}';`)
    await expect(
      db.query(`select capture_lead('${key}', 'Late', '9000000013', null, '{}'::jsonb);`),
    ).rejects.toThrow()
  })
})

describe('attendance check-out and fence (0030)', () => {
  let db: PGlite
  const owner = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee'

  beforeAll(async () => {
    db = await freshDb()
    await db.exec(`insert into auth.users (id, email) values ('${owner}', 'owner@hr.test');`)
    await asUser(db, owner)
    await db.query(`select register_company_and_admin('HR Studio','Owner');`)
  })

  it('refuses to check out of a day that was never checked into', async () => {
    // Silently creating a row here would invent a shift nobody worked.
    await expect(db.query(`select check_out();`)).rejects.toThrow()
  })

  it('closes the day it was opened on', async () => {
    await db.query(`select check_in(19.076, 72.8777);`)
    const id = (await db.query<{ id: string }>(`select check_out() as id;`)).rows[0]!.id

    const r = await db.query<{ check_in_at: string; check_out_at: string; a_date: string }>(
      `select check_in_at, check_out_at, a_date from attendance where id = '${id}';`,
    )
    expect(r.rows[0]!.check_out_at).not.toBeNull()
    // One row per person per day: checking out must not open a second one.
    const count = await db.query<{ n: number }>(
      `select count(*)::int as n from attendance where user_id = '${owner}';`,
    )
    expect(count.rows[0]!.n).toBe(1)
  })

  it('will not check out twice', async () => {
    await expect(db.query(`select check_out();`)).rejects.toThrow()
  })

  it('stores a fence and refuses a radius that would be useless', async () => {
    const r = await db.query<{ radius_m: number; timezone: string }>(
      `select radius_m, timezone from set_company_location(19.076, 72.8777, 200, 'Asia/Kolkata');`,
    )
    expect(r.rows[0]!.radius_m).toBe(200)
    expect(r.rows[0]!.timezone).toBe('Asia/Kolkata')

    // Under 20m GPS drift alone locks people out; over 5km is not a fence.
    await expect(db.query(`select set_company_location(19.076, 72.8777, 5, 'Asia/Kolkata');`)).rejects.toThrow()
    await expect(db.query(`select set_company_location(19.076, 72.8777, 9000, 'Asia/Kolkata');`)).rejects.toThrow()
  })

  it('moves the fence rather than stacking a second one', async () => {
    await db.query(`select set_company_location(28.6139, 77.209, 300, 'Asia/Kolkata');`)
    const r = await db.query<{ n: number; lat: number }>(
      `select count(*)::int as n, max(lat) as lat from company_location;`,
    )
    expect(r.rows[0]!.n).toBe(1)
    expect(Number(r.rows[0]!.lat)).toBeCloseTo(28.6139, 3)
  })

  it('keeps the fence out once it is set', async () => {
    // Same coordinates the fence was just moved away from.
    await expect(db.query(`select check_in(19.076, 72.8777);`)).rejects.toThrow()
  })
})

describe('task bundles (0031)', () => {
  let db: PGlite
  const owner = 'ffffffff-ffff-ffff-ffff-ffffffffffff'
  let bundle: string

  beforeAll(async () => {
    db = await freshDb()
    await db.exec(`insert into auth.users (id, email) values ('${owner}', 'owner@bundle.test');`)
    await asUser(db, owner)
    await db.query(`select register_company_and_admin('Bundle Studio','Owner');`)

    const b = await db.query<{ id: string }>(
      `insert into task_bundles (company_id, name)
       values (get_current_company_id(), 'Wedding editing') returning id;`,
    )
    bundle = b.rows[0]!.id
    for (const [i, title] of ['Cull and select', 'Colour grade', 'Album layout'].entries()) {
      await db.exec(
        `insert into task_bundle_items (bundle_id, company_id, title, priority, sort_order)
         values ('${bundle}', get_current_company_id(), '${title}', 'medium', ${i});`,
      )
    }
  })

  it('stamps out one task per item, keeping the checklist order', async () => {
    const count = (
      await db.query<{ n: number }>(`select apply_task_bundle('${bundle}', null, '{}') as n;`)
    ).rows[0]!.n
    expect(count).toBe(3)

    const tasks = await db.query<{ title: string; status: string }>(
      `select title, status from tasks order by created_at, title;`,
    )
    expect(tasks.rows).toHaveLength(3)
    expect(tasks.rows.every((t) => t.status === 'to_do')).toBe(true)
  })

  it('can raise the same checklist against a project', async () => {
    const client = (
      await db.query<{ id: string }>(
        `insert into clients (company_id, name) values (get_current_company_id(), 'Sharma') returning id;`,
      )
    ).rows[0]!.id
    const project = (
      await db.query<{ id: string }>(
        `insert into projects (company_id, client_id, name)
         values (get_current_company_id(), '${client}', 'Sharma Wedding') returning id;`,
      )
    ).rows[0]!.id

    await db.query(`select apply_task_bundle('${bundle}', '${project}', '{}');`)
    const linked = await db.query<{ n: number }>(
      `select count(*)::int as n from tasks where project_id = '${project}';`,
    )
    expect(linked.rows[0]!.n).toBe(3)
  })

  it('refuses a bundle or project belonging to someone else', async () => {
    // SECURITY DEFINER bypassed RLS to get here, so the function has to do the
    // tenant check itself — an id alone must not reach across studios.
    await expect(
      db.query(`select apply_task_bundle('${owner}'::uuid, null, '{}');`),
    ).rejects.toThrow()
    await expect(
      db.query(`select apply_task_bundle('${bundle}', '${owner}'::uuid, '{}');`),
    ).rejects.toThrow()
  })

  it('writes bundles through the admin/manager policy 0007 set', async () => {
    // The tables were always policied; only a way to use them was missing.
    const policies = await db.query<{ policyname: string }>(
      `select policyname from pg_policies
        where tablename in ('task_bundles', 'task_bundle_items');`,
    )
    expect(policies.rows.map((p) => p.policyname).sort()).toEqual([
      'task_bundle_items_select',
      'task_bundle_items_write',
      'task_bundles_select',
      'task_bundles_write',
    ])
  })
})

describe('shoot details (0038)', () => {
  let db: PGlite
  beforeAll(async () => {
    db = await freshDb()
    await db.exec(`insert into auth.users (id, email) values ('${OWNER}', 'owner@studio.test');`)
    await asUser(db, OWNER)
    await db.query(`select register_company_and_admin('Studio','Owner');`)
  })

  it('gives a shoot somewhere to keep its map link', async () => {
    const cols = await db.query<{ column_name: string }>(
      `select column_name from information_schema.columns
        where table_name = 'shoots' and column_name = 'map_link';`,
    )
    expect(cols.rows).toHaveLength(1)
  })

  it('policies presets the way every other company-scoped table is', async () => {
    const policies = await db.query<{ policyname: string }>(
      `select policyname from pg_policies where tablename = 'shoot_presets';`,
    )
    expect(policies.rows.map((p) => p.policyname).sort()).toEqual([
      'shoot_presets_select',
      'shoot_presets_write',
    ])
  })

  // "Save preset" under a name that exists is an overwrite, not a second row.
  it('keeps one preset per name and kind', async () => {
    const company = await db.query<{ id: string }>(`select id from companies limit 1;`)
    const id = company.rows[0]!.id
    await db.query(
      `insert into shoot_presets (company_id, kind, name, payload)
       values ('${id}', 'shoot', 'Wedding day', '{"requirements": []}'::jsonb);`,
    )
    await expect(
      db.query(
        `insert into shoot_presets (company_id, kind, name, payload)
         values ('${id}', 'shoot', 'Wedding day', '{}'::jsonb);`,
      ),
    ).rejects.toThrow()
    // Same name, different kind, is a different preset.
    await db.query(
      `insert into shoot_presets (company_id, kind, name, payload)
       values ('${id}', 'internal_work', 'Wedding day', '{}'::jsonb);`,
    )
    const rows = await db.query(`select 1 from shoot_presets;`)
    expect(rows.rows).toHaveLength(2)
  })

  it('rejects a kind nobody handles', async () => {
    const company = await db.query<{ id: string }>(`select id from companies limit 1;`)
    await expect(
      db.query(
        `insert into shoot_presets (company_id, kind, name)
         values ('${company.rows[0]!.id}', 'moodboard', 'x');`,
      ),
    ).rejects.toThrow()
  })
})

describe('deliverable sets (0039)', () => {
  let db: PGlite
  beforeAll(async () => {
    db = await freshDb()
    await db.exec(`insert into auth.users (id, email) values ('${OWNER}', 'owner@studio.test');`)
    await asUser(db, OWNER)
    await db.query(`select register_company_and_admin('Studio','Owner');`)
  })

  it('policies sets the way every other company-scoped table is', async () => {
    const policies = await db.query<{ policyname: string }>(
      `select policyname from pg_policies where tablename = 'deliverable_sets';`,
    )
    expect(policies.rows.map((p) => p.policyname).sort()).toEqual([
      'deliverable_sets_select',
      'deliverable_sets_write',
    ])
  })

  it('keeps one set per name, so saving over a package replaces it', async () => {
    const company = await db.query<{ id: string }>(`select id from companies limit 1;`)
    const id = company.rows[0]!.id
    await db.query(
      `insert into deliverable_sets (company_id, name, items)
       values ('${id}', 'Premium', '[{"title": "Photo Album"}]'::jsonb);`,
    )
    await expect(
      db.query(
        `insert into deliverable_sets (company_id, name, items)
         values ('${id}', 'Premium', '[]'::jsonb);`,
      ),
    ).rejects.toThrow()
  })

  it('goes with the company', async () => {
    const before = await db.query(`select 1 from deliverable_sets;`)
    expect(before.rows.length).toBeGreaterThan(0)
    await db.exec(`delete from companies;`)
    const after = await db.query(`select 1 from deliverable_sets;`)
    expect(after.rows).toHaveLength(0)
  })
})

describe('plan gate sits on feature access, not identity (0034)', () => {
  let db: PGlite
  const owner = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'
  const member = 'cccccccc-cccc-cccc-cccc-cccccccccccc'
  let planId: string

  const rotate = async (raw: string) =>
    (
      await db.query<{ user_id: string | null; token: string | null }>(
        `select * from rotate_refresh_token('${raw}');`,
      )
    ).rows[0]!

  beforeAll(async () => {
    db = await freshDb()
    await db.exec(
      `insert into auth.users (id, email) values ('${owner}','owner@gate.test'),('${member}','member@gate.test');`,
    )
    await asUser(db, owner)
    await db.query(`select register_company_and_admin('Gate Studio','Owner');`)
    await db.exec(
      `insert into users (user_id, company_id, role, name, email)
       values ('${member}', get_current_company_id(), 'employee', 'Member', 'member@gate.test');`,
    )
    const p = await db.query<{ id: string }>(
      `insert into plans (key, name, price, billing_interval) values ('renew','Renew', 1000, 'monthly') returning id;`,
    )
    planId = p.rows[0]!.id
    // Lapse the plan entirely: no expiry, no trial, no grace.
    await db.exec(
      `update companies set grandfathered_until = null, plan_expiry = null, grace_until = null
       where id = get_current_company_id();`,
    )
  })

  it('an expired studio still resolves its tenant, but is not "active"', async () => {
    await asUser(db, owner)
    const r = await db.query<{ company: string | null; active: boolean; owner: boolean }>(
      `select get_current_company_id() as company, is_current_user_active() as active, is_current_owner() as owner;`,
    )
    expect(r.rows[0]!.company).not.toBeNull()
    expect(r.rows[0]!.active).toBe(false)
    expect(r.rows[0]!.owner).toBe(true)
  })

  it('the owner can start checkout while expired — the recovery path', async () => {
    await asUser(db, owner)
    const order = await db.query<{ order_id: string }>(
      `select * from create_payment_order('${planId}');`,
    )
    expect(order.rows[0]!.order_id).toBeTruthy()
    await db.query(`select * from activate_subscription('${order.rows[0]!.order_id}', 'pay_renew');`)
    const active = await db.query<{ active: boolean }>(`select is_current_user_active() as active;`)
    expect(active.rows[0]!.active).toBe(true)
    // Back to lapsed for the tests below.
    await db.exec(`update companies set plan_expiry = null where id = get_current_company_id();`)
  })

  it('get_auth_context reports the lapse so the app can route to renewal', async () => {
    await asUser(db, owner)
    const ctx = await db.query<{ plan_gate: string; company_id: string }>(
      `select * from get_auth_context();`,
    )
    expect(ctx.rows[0]!.plan_gate).toBe('expired')
    expect(ctx.rows[0]!.company_id).toBeTruthy()
  })

  it('a refresh session survives a lapsed plan', async () => {
    const raw = (await db.query<{ t: string }>(`select issue_refresh_token('${owner}') as t;`))
      .rows[0]!.t
    const r = await rotate(raw)
    expect(r.user_id).toBe(owner)
    expect(r.token).not.toBeNull()
  })

  it('a refresh session does NOT survive a removed member', async () => {
    const raw = (await db.query<{ t: string }>(`select issue_refresh_token('${member}') as t;`))
      .rows[0]!.t
    await db.exec(
      `update users set deleted_at = now(), status = 'inactive' where user_id = '${member}';`,
    )
    const r = await rotate(raw)
    expect(r.user_id).toBeNull()
    const live = await db.query<{ n: number }>(
      `select count(*)::int as n from refresh_tokens where user_id = '${member}' and revoked_at is null;`,
    )
    expect(live.rows[0]!.n).toBe(0)
    // And the identity oracle no longer resolves them at all.
    await asUser(db, member)
    const ctx = await db.query(`select * from get_auth_context();`)
    expect(ctx.rows.length).toBe(0)
    const company = await db.query<{ c: string | null }>(`select get_current_company_id() as c;`)
    expect(company.rows[0]!.c).toBeNull()
  })

  it('audit_log_write stamps the caller and their own studio', async () => {
    await asUser(db, owner)
    const id = (
      await db.query<{ id: string }>(
        `select audit_log_write('company.update', 'company', 'x', '{"name":"a"}'::jsonb, '{"name":"b"}'::jsonb, '127.0.0.1', 'req-1') as id;`,
      )
    ).rows[0]!.id
    const row = await db.query<{
      company_id: string
      actor_user_id: string
      action: string
      correlation_id: string
    }>(`select company_id, actor_user_id, action, correlation_id from audit_logs where id = '${id}';`)
    expect(row.rows[0]!.actor_user_id).toBe(owner)
    expect(row.rows[0]!.action).toBe('company.update')
    expect(row.rows[0]!.correlation_id).toBe('req-1')
    expect(row.rows[0]!.company_id).toBe(
      (await db.query<{ c: string }>(`select get_current_company_id() as c;`)).rows[0]!.c,
    )
  })

  it('audit_log_write refuses a caller with no studio', async () => {
    await asUser(db, '99999999-9999-9999-9999-999999999999')
    await expect(db.query(`select audit_log_write('x', 'y');`)).rejects.toThrow(/no company/i)
  })
})

describe('CRM v2 — events, archive, merge, stats (0032 + 0034)', () => {
  let db: PGlite
  const owner = 'dddddddd-dddd-dddd-dddd-dddddddddddd'

  const add = async (name: string, phone: string) =>
    (
      await db.query<{ id: string }>(
        `select add_lead('${name}', '${phone}', null, 'enquiry', null, null) as id;`,
      )
    ).rows[0]!.id

  const events = async (leadId: string) =>
    (
      await db.query<{ from_status: string | null; to_status: string | null; note: string | null }>(
        `select from_status, to_status, note from crm_lead_events where lead_id = '${leadId}' order by created_at;`,
      )
    ).rows

  beforeAll(async () => {
    db = await freshDb()
    await db.exec(`insert into auth.users (id, email) values ('${owner}', 'owner@crm2.test');`)
    await asUser(db, owner)
    await db.query(`select register_company_and_admin('CRM2 Studio','Owner');`)
  })

  it('a lead history starts at creation and records every stage move', async () => {
    const id = await add('Aanya', '9876600001')
    expect(await events(id)).toEqual([{ from_status: null, to_status: 'new', note: 'created' }])
    await db.exec(`update crm_leads set status = 'contacted' where id = '${id}';`)
    const trail = await events(id)
    expect(trail).toHaveLength(2)
    expect(trail[1]).toMatchObject({ from_status: 'new', to_status: 'contacted' })
    const stamped = await db.query<{ stage_changed_at: string | null }>(
      `select stage_changed_at from crm_leads where id = '${id}';`,
    )
    expect(stamped.rows[0]!.stage_changed_at).not.toBeNull()
  })

  it('archiving stamps archived_at, restoring clears it', async () => {
    const id = await add('Rahul', '9876600002')
    await db.exec(`update crm_leads set is_archived = true where id = '${id}';`)
    let r = await db.query<{ archived_at: string | null }>(
      `select archived_at from crm_leads where id = '${id}';`,
    )
    expect(r.rows[0]!.archived_at).not.toBeNull()
    await db.exec(`update crm_leads set is_archived = false where id = '${id}';`)
    r = await db.query<{ archived_at: string | null }>(
      `select archived_at from crm_leads where id = '${id}';`,
    )
    expect(r.rows[0]!.archived_at).toBeNull()
  })

  it('crm_stats counts only unarchived leads', async () => {
    const stats = await db.query<{ s: { total: number; byStatus: Record<string, number> } }>(
      `select crm_stats(30) as s;`,
    )
    expect(stats.rows[0]!.s.total).toBe(2)
    expect(stats.rows[0]!.s.byStatus.contacted).toBe(1)
  })

  it('merge_leads archives the duplicates and notes it on the survivor', async () => {
    // Two rows for one number only happen when a typo is corrected later, so
    // seed the collision directly.
    const a = await add('Priya', '9876600003')
    const b = (
      await db.query<{ id: string }>(
        `insert into crm_leads (company_id, name, phone, phone_norm, source, notes)
         values (get_current_company_id(), 'Priya S', '9876600003', crm_normalize_phone('9876600003'), 'manual', 'from the second form')
         returning id;`,
      )
    ).rows[0]!.id
    const groups = await db.query<{ lead_count: number }>(`select * from crm_duplicate_groups();`)
    expect(groups.rows[0]!.lead_count).toBe(2)

    const merged = await db.query<{ n: number }>(
      `select merge_leads('${a}', array['${b}']::uuid[]) as n;`,
    )
    expect(merged.rows[0]!.n).toBe(1)
    const dup = await db.query<{ is_archived: boolean }>(
      `select is_archived from crm_leads where id = '${b}';`,
    )
    expect(dup.rows[0]!.is_archived).toBe(true)
    const survivor = await db.query<{ notes: string }>(`select notes from crm_leads where id = '${a}';`)
    expect(survivor.rows[0]!.notes).toContain('from the second form')
    expect((await db.query(`select * from crm_duplicate_groups();`)).rows).toHaveLength(0)
  })
})

describe('CRM v3 — merge/unmerge, import, bulk undo, ranged stats, automations (0035)', () => {
  let db: PGlite
  const owner = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee'
  const member = 'ffffffff-ffff-ffff-ffff-ffffffffffff'

  const add = async (name: string, phone: string) =>
    (
      await db.query<{ id: string }>(
        `select add_lead('${name}', '${phone}', null, 'enquiry', null, null) as id;`,
      )
    ).rows[0]!.id

  const lead = async (id: string) =>
    (
      await db.query<{
        status: string
        is_archived: boolean
        merged_into: string | null
        assigned_to: string | null
        is_hot: boolean
        follow_up_at: string | null
        notes: string | null
      }>(
        `select status, is_archived, merged_into, assigned_to, is_hot, follow_up_at, notes from crm_leads where id = '${id}';`,
      )
    ).rows[0]!

  beforeAll(async () => {
    db = await freshDb()
    await db.exec(
      `insert into auth.users (id, email) values ('${owner}','owner@crm3.test'),('${member}','member@crm3.test');`,
    )
    await asUser(db, owner)
    await db.query(`select register_company_and_admin('CRM3 Studio','Owner');`)
    await db.exec(
      `insert into users (user_id, company_id, role, name, email)
       values ('${member}', get_current_company_id(), 'employee', 'Meera', 'member@crm3.test');`,
    )
  })

  it('merge keeps the duplicate status, records merged_into, and unmerge puts it all back', async () => {
    const a = await add('Priya', '9876700001')
    const b = (
      await db.query<{ id: string }>(
        `insert into crm_leads (company_id, name, phone, phone_norm, source, status, notes)
         values (get_current_company_id(), 'Priya S', '9876700001', crm_normalize_phone('9876700001'), 'manual', 'qualified', 'second form')
         returning id;`,
      )
    ).rows[0]!.id

    const groups = await db.query<{ leads: { id: string; name: string }[] }>(
      `select * from crm_duplicate_groups();`,
    )
    expect(groups.rows[0]!.leads.map((l) => l.name)).toEqual(['Priya', 'Priya S'])

    await db.query(`select merge_leads('${a}', array['${b}']::uuid[]);`)
    let dup = await lead(b)
    expect(dup.is_archived).toBe(true)
    expect(dup.merged_into).toBe(a)
    expect(dup.status).toBe('qualified') // not forced to lost
    expect((await lead(a)).notes).toContain('[merged from')

    const restored = await db.query<{ n: number }>(`select unmerge_leads('${a}') as n;`)
    expect(restored.rows[0]!.n).toBe(1)
    dup = await lead(b)
    expect(dup.is_archived).toBe(false)
    expect(dup.merged_into).toBeNull()
    expect((await lead(a)).notes).toBeNull()
  })

  it('import is one transaction and counts duplicates honestly', async () => {
    await add('Known', '9876700002')
    const rows = JSON.stringify([
      { name: 'Known again', phone: '98767 00002' },
      { name: 'Fresh', phone: '9876700003', email: 'f@x.in', notes: 'from sheet' },
      { name: 'Junk', phone: '12' },
    ])
    const r = await db.query<{ r: { created: number; skipped: number; invalid: number; ids: string[] } }>(
      `select crm_import_leads('${rows}'::jsonb, true) as r;`,
    )
    expect(r.rows[0]!.r).toMatchObject({ created: 1, skipped: 1, invalid: 1 })
    expect(r.rows[0]!.r.ids).toHaveLength(1)
    const fresh = await db.query<{ source_key: string; notes: string }>(
      `select source_key, notes from crm_leads where id = '${r.rows[0]!.r.ids[0]}';`,
    )
    expect(fresh.rows[0]).toEqual({ source_key: 'csv_import', notes: 'from sheet' })
    // Not skipping inserts beside the existing row, for the duplicates tab.
    const again = await db.query<{ r: { created: number; skipped: number } }>(
      `select crm_import_leads('[{"phone":"9876700002"}]'::jsonb, false) as r;`,
    )
    expect(again.rows[0]!.r).toMatchObject({ created: 1, skipped: 0 })
    const count = await db.query<{ n: number }>(
      `select count(*)::int as n from crm_leads where phone_norm = crm_normalize_phone('9876700002');`,
    )
    expect(count.rows[0]!.n).toBe(2)
  })

  it('bulk patch hands back a snapshot that restores exactly', async () => {
    const x = await add('Bulk A', '9876700010')
    const y = await add('Bulk B', '9876700011')
    const snap = await db.query<{ id: string; status: string; is_hot: boolean; is_archived: boolean }>(
      `select * from crm_bulk_patch(array['${x}','${y}']::uuid[], '{"status":"proposal_sent","is_hot":true}'::jsonb);`,
    )
    expect(snap.rows).toHaveLength(2)
    expect(snap.rows.every((r) => r.status === 'new' && r.is_hot === false)).toBe(true)
    expect((await lead(x)).status).toBe('proposal_sent')
    expect((await lead(x)).is_hot).toBe(true)

    const restored = await db.query<{ n: number }>(
      `select crm_restore_leads('${JSON.stringify(snap.rows)}'::jsonb) as n;`,
    )
    expect(restored.rows[0]!.n).toBe(2)
    expect((await lead(x)).status).toBe('new')
    expect((await lead(y)).is_hot).toBe(false)
  })

  it('bulk patch refuses a status the pipeline does not have', async () => {
    const x = await add('Bulk C', '9876700012')
    await expect(
      db.query(`select * from crm_bulk_patch(array['${x}']::uuid[], '{"status":"won"}'::jsonb);`),
    ).rejects.toThrow(/unknown status/)
  })

  it('ranged stats and the team view count the window, not all time', async () => {
    const w = await add('Won lead', '9876700020')
    await db.exec(`update crm_leads set assigned_to = '${member}' where id = '${w}';`)
    await db.exec(`update crm_leads set status = 'converted' where id = '${w}';`)
    const stats = await db.query<{ s: { won: number; created: number; conversion_rate: number } }>(
      `select crm_stats(current_date - 7, current_date) as s;`,
    )
    expect(stats.rows[0]!.s.won).toBe(1)
    expect(stats.rows[0]!.s.created).toBeGreaterThan(1)
    const old = await db.query<{ s: { won: number; created: number } }>(
      `select crm_stats(current_date - 30, current_date - 8) as s;`,
    )
    expect(old.rows[0]!.s).toMatchObject({ won: 0, created: 0 })
    await expect(db.query(`select crm_stats(current_date, current_date - 1);`)).rejects.toThrow(/range/)

    const team = await db.query<{ user_name: string; won: number; open: number }>(
      `select * from crm_team_stats(current_date - 7, current_date);`,
    )
    const meera = team.rows.find((r) => r.user_name === 'Meera')!
    expect(meera.won).toBe(1)
    expect(meera.open).toBe(0)
  })

  it('a rule fires on arrival, and its own update does not re-fire it', async () => {
    await db.exec(
      `insert into crm_automation_rules (company_id, name, trigger, condition, action, action_value)
       values (get_current_company_id(), 'Hot enquiries', 'lead_created', '{"source":"enquiry"}', 'mark_hot', '{}'),
              (get_current_company_id(), 'Assign Meera', 'lead_created', '{}', 'assign_to', '{"user_id":"${member}"}'),
              (get_current_company_id(), 'Quote follow-up', 'stage_changed', '{"to_status":"proposal_sent"}', 'set_follow_up_days', '{"days":2}');`,
    )
    const id = await add('Auto', '9876700030')
    const l = await lead(id)
    expect(l.is_hot).toBe(true)
    expect(l.assigned_to).toBe(member)
    const trail = await db.query<{ note: string | null }>(
      `select note from crm_lead_events where lead_id = '${id}' and note like 'automation:%' order by created_at;`,
    )
    expect(trail.rows.map((r) => r.note)).toEqual(['automation: Hot enquiries', 'automation: Assign Meera'])

    await db.exec(`update crm_leads set status = 'proposal_sent' where id = '${id}';`)
    expect((await lead(id)).follow_up_at).not.toBeNull()
    // Exactly one application per rule: the nested updates did not loop.
    const applied = await db.query<{ n: number }>(
      `select count(*)::int as n from crm_lead_events where lead_id = '${id}' and note like 'automation:%';`,
    )
    expect(applied.rows[0]!.n).toBe(3)
  })

  it('the follow-up sweep notifies the owner once a day and records a run', async () => {
    const id = await add('Late', '9876700040')
    await db.exec(
      `update crm_leads set assigned_to = '${member}', follow_up_at = now() - interval '2 days' where id = '${id}';`,
    )
    const first = await db.query<{ s: { overdue: number; notified: number } }>(
      `select run_crm_followup_cron(false) as s;`,
    )
    expect(first.rows[0]!.s.overdue).toBeGreaterThanOrEqual(1)
    expect(first.rows[0]!.s.notified).toBeGreaterThanOrEqual(1)
    const second = await db.query<{ s: { notified: number } }>(`select run_crm_followup_cron(false) as s;`)
    expect(second.rows[0]!.s.notified).toBe(0)
    const runs = await db.query<{ n: number }>(
      `select count(*)::int as n from cron_runs where job_name = 'crm_followup_cron' and finished_at is not null;`,
    )
    expect(runs.rows[0]!.n).toBe(2)
    const notif = await db.query<{ type: string }>(
      `select type from notifications where recipient_uid = '${member}' and entity_id = '${id}';`,
    )
    expect(notif.rows[0]!.type).toBe('crm_overdue')
  })

  it('an owner can correct attendance; an employee cannot; a stranger is refused', async () => {
    await asUser(db, owner)
    const id = (
      await db.query<{ id: string }>(
        `select set_attendance_manual('${member}', current_date, 'present',
           now() - interval '8 hours', now(), 'Forgot to tap in') as id;`,
      )
    ).rows[0]!.id
    const row = await db.query<{ status: string; corrected_by: string; correction_note: string }>(
      `select status, corrected_by, correction_note from attendance where id = '${id}';`,
    )
    expect(row.rows[0]).toEqual({ status: 'present', corrected_by: owner, correction_note: 'Forgot to tap in' })
    // Correcting again replaces rather than duplicating.
    await db.query(`select set_attendance_manual('${member}', current_date, 'late', null, null, null);`)
    const count = await db.query<{ n: number }>(
      `select count(*)::int as n from attendance where user_id = '${member}' and a_date = current_date;`,
    )
    expect(count.rows[0]!.n).toBe(1)

    await expect(
      db.query(
        `select set_attendance_manual('${owner}', current_date, 'present', now(), now() - interval '1 hour');`,
      ),
    ).rejects.toThrow(/before/)
    await expect(
      db.query(
        `select set_attendance_manual('99999999-9999-9999-9999-999999999999', current_date, 'present');`,
      ),
    ).rejects.toThrow(/unknown_member/)

    await asUser(db, member)
    await expect(
      db.query(`select set_attendance_manual('${member}', current_date, 'present');`),
    ).rejects.toThrow(/not allowed/)
  })
})

describe('CRM v4 — saved views, SLA, cadences, conversion (0036)', () => {
  let db: PGlite
  const owner = '12121212-1212-1212-1212-121212121212'
  const member = '34343434-3434-3434-3434-343434343434'

  const add = async (name: string, phone: string) =>
    (
      await db.query<{ id: string }>(
        `select add_lead('${name}', '${phone}', null, 'enquiry', null, null) as id;`,
      )
    ).rows[0]!.id

  beforeAll(async () => {
    db = await freshDb()
    await db.exec(
      `insert into auth.users (id, email) values ('${owner}','owner@crm4.test'),('${member}','member@crm4.test');`,
    )
    await asUser(db, owner)
    await db.query(`select register_company_and_admin('CRM4 Studio','Owner');`)
    await db.exec(
      `insert into users (user_id, company_id, role, name, email)
       values ('${member}', get_current_company_id(), 'employee', 'Meera', 'member@crm4.test');`,
    )
  })

  it('a saved view belongs to one person and one name', async () => {
    await asUser(db, owner)
    await db.exec(
      `insert into crm_saved_views (company_id, user_id, name, query)
       values (get_current_company_id(), '${owner}', 'My overdue', '{"filters":["overdue"]}');`,
    )
    await expect(
      db.exec(
        `insert into crm_saved_views (company_id, user_id, name, query)
         values (get_current_company_id(), '${owner}', 'My overdue', '{}');`,
      ),
    ).rejects.toThrow()
    // Another person may use the same name.
    await db.exec(
      `insert into crm_saved_views (company_id, user_id, name, query)
       values (get_current_company_id(), '${member}', 'My overdue', '{}');`,
    )
    const n = await db.query<{ n: number }>(`select count(*)::int as n from crm_saved_views;`)
    expect(n.rows[0]!.n).toBe(2)
  })

  it('the SLA target defaults to 24h and follows the settings row', async () => {
    await asUser(db, owner)
    expect((await db.query<{ h: number }>(`select crm_sla_hours() as h;`)).rows[0]!.h).toBe(24)
    await db.exec(`insert into crm_settings (company_id, sla_hours) values (get_current_company_id(), 4);`)
    expect((await db.query<{ h: number }>(`select crm_sla_hours() as h;`)).rows[0]!.h).toBe(4)
    await expect(db.exec(`update crm_settings set sla_hours = 0;`)).rejects.toThrow()
  })

  it('converting a lead creates the client and the project and marks the lead', async () => {
    await asUser(db, owner)
    const lead = await add('Aanya Sharma', '9876800001')
    const r = await db.query<{ client_id: string; project_id: string }>(
      `select * from convert_lead_to_project('${lead}', null, '{"city":"Mumbai"}'::jsonb,
         '{"name":"Aanya wedding","package_cost":150000}'::jsonb);`,
    )
    const { client_id, project_id } = r.rows[0]!
    const client = await db.query<{ name: string; phone: string; city: string }>(
      `select name, phone, city from clients where id = '${client_id}';`,
    )
    expect(client.rows[0]).toEqual({ name: 'Aanya Sharma', phone: '9876800001', city: 'Mumbai' })
    const project = await db.query<{ name: string; package_cost: number; client_id: string }>(
      `select name, package_cost, client_id from projects where id = '${project_id}';`,
    )
    expect(project.rows[0]).toMatchObject({ name: 'Aanya wedding', client_id })
    expect(Number(project.rows[0]!.package_cost)).toBe(150000)
    const l = await db.query<{ status: string; converted_project_id: string; converted_at: string | null }>(
      `select status, converted_project_id, converted_at from crm_leads where id = '${lead}';`,
    )
    expect(l.rows[0]!.status).toBe('converted')
    expect(l.rows[0]!.converted_project_id).toBe(project_id)
    expect(l.rows[0]!.converted_at).not.toBeNull()
    // Twice is refused; an existing client is honoured.
    await expect(db.query(`select * from convert_lead_to_project('${lead}');`)).rejects.toThrow(/already/)
    const lead2 = await add('Rahul', '9876800002')
    const r2 = await db.query<{ client_id: string }>(
      `select * from convert_lead_to_project('${lead2}', '${client_id}', '{}', '{"name":"Second shoot"}');`,
    )
    expect(r2.rows[0]!.client_id).toBe(client_id)
  })

  it('a cadence schedules each step in turn, and stops when the lead closes', async () => {
    await asUser(db, owner)
    const cad = (
      await db.query<{ id: string }>(
        `insert into crm_cadences (company_id, name) values (get_current_company_id(), 'Wedding follow-up') returning id;`,
      )
    ).rows[0]!.id
    await db.exec(
      `insert into crm_cadence_steps (cadence_id, company_id, step_no, day_offset, note)
       values ('${cad}', get_current_company_id(), 1, 0, 'Call'), ('${cad}', get_current_company_id(), 2, 3, 'Send quote');`,
    )
    const lead = await add('Cadence lead', '9876800010')
    await db.exec(`update crm_leads set assigned_to = '${member}' where id = '${lead}';`)
    await db.query(`select start_lead_cadence('${lead}', '${cad}');`)
    let lc = await db.query<{ step_no: number; next_at: string }>(
      `select step_no, next_at from crm_lead_cadences where lead_id = '${lead}';`,
    )
    expect(lc.rows[0]!.step_no).toBe(1)
    const follow = await db.query<{ f: string }>(`select follow_up_at as f from crm_leads where id = '${lead}';`)
    expect(new Date(follow.rows[0]!.f).getTime()).toBe(new Date(lc.rows[0]!.next_at).getTime())

    // Make step 1 due and sweep: notification to the owner, moved to step 2.
    await db.exec(`update crm_lead_cadences set next_at = now() - interval '1 minute' where lead_id = '${lead}';`)
    const sweep = await db.query<{ s: { cadences: { due: number; advanced: number; completed: number } } }>(
      `select run_crm_followup_cron(false) as s;`,
    )
    expect(sweep.rows[0]!.s.cadences).toMatchObject({ due: 1, advanced: 1, completed: 0 })
    lc = await db.query<{ step_no: number; next_at: string }>(
      `select step_no, next_at from crm_lead_cadences where lead_id = '${lead}';`,
    )
    expect(lc.rows[0]!.step_no).toBe(2)
    const notif = await db.query<{ type: string; title: string }>(
      `select type, title from notifications where recipient_uid = '${member}' and entity_id = '${lead}' and type = 'crm_cadence';`,
    )
    expect(notif.rows[0]!.title).toContain('step 1')

    // Final step completes it.
    await db.exec(`update crm_lead_cadences set next_at = now() - interval '1 minute' where lead_id = '${lead}';`)
    await db.query(`select run_crm_followup_cron(false);`)
    const done = await db.query<{ completed_at: string | null }>(
      `select completed_at from crm_lead_cadences where lead_id = '${lead}';`,
    )
    expect(done.rows[0]!.completed_at).not.toBeNull()

    // A lead that closes mid-cadence is taken off it.
    const lead2 = await add('Closes early', '9876800011')
    await db.query(`select start_lead_cadence('${lead2}', '${cad}');`)
    await db.exec(`update crm_leads set status = 'lost' where id = '${lead2}';`)
    const stopped = await db.query<{ stopped_at: string | null }>(
      `select stopped_at from crm_lead_cadences where lead_id = '${lead2}';`,
    )
    expect(stopped.rows[0]!.stopped_at).not.toBeNull()
    expect(
      (await db.query<{ ok: boolean }>(`select stop_lead_cadence('${lead2}') as ok;`)).rows[0]!.ok,
    ).toBe(false)
  })

  it('an automation can start a cadence on arrival', async () => {
    await asUser(db, owner)
    const cad = (
      await db.query<{ id: string }>(
        `select id from crm_cadences where name = 'Wedding follow-up';`,
      )
    ).rows[0]!.id
    await db.exec(
      `insert into crm_automation_rules (company_id, name, trigger, condition, action, action_value)
       values (get_current_company_id(), 'Auto cadence', 'lead_created', '{"source":"enquiry"}', 'start_cadence', '{"cadence_id":"${cad}"}');`,
    )
    const lead = await add('Auto cadence lead', '9876800020')
    const lc = await db.query<{ cadence_id: string }>(`select cadence_id from crm_lead_cadences where lead_id = '${lead}';`)
    expect(lc.rows[0]!.cadence_id).toBe(cad)
  })

  it('the team view counts first contact within the SLA', async () => {
    await asUser(db, owner)
    const fast = await add('Fast', '9876800030')
    const slow = await add('Slow', '9876800031')
    await db.exec(`update crm_leads set assigned_to = '${member}' where id in ('${fast}','${slow}');`)
    await db.exec(`update crm_leads set status = 'contacted' where id = '${fast}';`)
    // Contacted 10 hours after arrival, against the 4h target set above.
    await db.exec(
      `update crm_leads set status = 'contacted', last_contacted_at = created_at + interval '10 hours' where id = '${slow}';`,
    )
    const team = await db.query<{ user_name: string; within_sla: number; sla_hours: number }>(
      `select user_name, within_sla, sla_hours from crm_team_stats(current_date - 7, current_date);`,
    )
    const meera = team.rows.find((r) => r.user_name === 'Meera')!
    expect(meera.sla_hours).toBe(4)
    expect(meera.within_sla).toBe(1)
  })
})
