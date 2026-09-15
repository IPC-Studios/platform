import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import { beforeAll, describe, expect, it } from 'vitest'

/**
 * A workflow's severity, cooldown and notify routing — and a cadence's stage
 * and source filters.
 *
 * All six columns existed, were seeded with real per-rule values, and were read
 * by nothing. The action runner notified only the lead's assignee, always at
 * severity 'info', with a dedupe key pinned to the calendar date — so the
 * seeded 2h / 72h / 168h cooldowns all behaved as 24h, the 'critical' rule was
 * indistinguishable from the informational ones, and a rule routed to managers
 * reached nobody. A cadence written for one stage started on any lead.
 *
 * Each test here fails against the old runner, which is the only reason to
 * write them: a setting nothing reads is worse than no setting at all.
 */
const migDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'migrations')

const OWNER = '11111111-1111-1111-1111-111111111111'
const COMPANY = '22222222-2222-2222-2222-222222222222'
const MANAGER = '33333333-3333-3333-3333-333333333333'
const REP = '44444444-4444-4444-4444-444444444444'

let db: PGlite

/** Run one workflow action against one lead, the way crm_run_enrollment does. */
async function act(workflowId: string, leadId: string, cfg: Record<string, unknown>) {
  await db.query(
    `select crm_workflow_do_action(
       (select l from crm_leads l where l.id = '${leadId}'),
       '${JSON.stringify(cfg)}'::jsonb,
       (select w from crm_workflows w where w.id = '${workflowId}'))`,
  )
}

/**
 * Only the rule under test. A new company is seeded with seven default
 * automation rules (0105) that fire on lead insert and notify the same people,
 * so anything counted per-recipient or per-lead counts those too. The dedupe
 * key carries the workflow id, which is the narrowest handle available.
 */
async function sentBy(workflowId: string) {
  const r = await db.query<{ recipient_uid: string; severity: string; dedupe_key: string }>(
    `select recipient_uid, severity, dedupe_key from notifications
      where dedupe_key like 'crm_wf:${workflowId}:%' order by created_at`,
  )
  return r.rows
}

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

  await db.exec(`insert into auth.users (id, email) values
    ('${OWNER}', 'owner@s.test'), ('${MANAGER}', 'mgr@s.test'), ('${REP}', 'rep@s.test');`)
  await db.exec(`
    insert into companies (id, name, owner_user_id) values ('${COMPANY}', 'Studio', '${OWNER}');
    insert into users (user_id, company_id, role, name, email) values
      ('${OWNER}', '${COMPANY}', 'super_admin', 'Owner', 'owner@s.test'),
      ('${MANAGER}', '${COMPANY}', 'manager', 'Manager', 'mgr@s.test'),
      ('${REP}', '${COMPANY}', 'employee', 'Rep', 'rep@s.test');
  `)
  await db.exec(`set request.jwt.claim.sub = '${OWNER}';`)
})

describe('workflow notify routing', () => {
  it('sends at the workflow’s severity, not always info', async () => {
    const lead = (
      await db.query<{ id: string }>(
        `insert into crm_leads (company_id, name, phone, assigned_to)
         values ('${COMPANY}', 'Sev Lead', '9000000001', '${REP}') returning id;`,
      )
    ).rows[0]!.id
    const wf = (
      await db.query<{ id: string }>(
        `insert into crm_workflows (company_id, name, trigger, severity, cooldown_hours)
         values ('${COMPANY}', 'Critical rule', 'lead_created', 'critical', 24) returning id;`,
      )
    ).rows[0]!.id

    await act(wf, lead, { action: 'notify_assignee', note: 'urgent', step: 1 })
    const got = await sentBy(wf)
    expect(got.length).toBe(1)
    expect(got[0]!.recipient_uid).toBe(REP)
    expect(got[0]!.severity).toBe('critical')
  })

  it('suppresses within the cooldown window and sends again outside it', async () => {
    const lead = (
      await db.query<{ id: string }>(
        `insert into crm_leads (company_id, name, phone, assigned_to)
         values ('${COMPANY}', 'Cooldown Lead', '9000000002', '${REP}') returning id;`,
      )
    ).rows[0]!.id
    // A two-hour cooldown. Under the old calendar-date key this was 24h.
    const wf = (
      await db.query<{ id: string }>(
        `insert into crm_workflows (company_id, name, trigger, cooldown_hours)
         values ('${COMPANY}', 'Two hourly', 'lead_created', 2) returning id;`,
      )
    ).rows[0]!.id

    await act(wf, lead, { action: 'notify_assignee', step: 1 })
    await act(wf, lead, { action: 'notify_assignee', step: 1 })
    expect((await sentBy(wf)).length).toBe(1)

    // The two keys three hours apart must differ — that is what lets the next
    // window through while the same window stays suppressed.
    const keys = await db.query<{ a: string; b: string }>(`
      select floor(extract(epoch from now()) / (2 * 3600))::bigint::text as a,
             floor(extract(epoch from now() + interval '3 hours') / (2 * 3600))::bigint::text as b`)
    expect(keys.rows[0]!.a).not.toBe(keys.rows[0]!.b)
  })

  it('a cooldown of zero never suppresses', async () => {
    const lead = (
      await db.query<{ id: string }>(
        `insert into crm_leads (company_id, name, phone, assigned_to)
         values ('${COMPANY}', 'No Cooldown', '9000000003', '${REP}') returning id;`,
      )
    ).rows[0]!.id
    const wf = (
      await db.query<{ id: string }>(
        `insert into crm_workflows (company_id, name, trigger, cooldown_hours)
         values ('${COMPANY}', 'Every time', 'lead_created', 0) returning id;`,
      )
    ).rows[0]!.id

    await act(wf, lead, { action: 'notify_assignee', step: 1 })
    await act(wf, lead, { action: 'notify_assignee', step: 1 })
    expect((await sentBy(wf)).length).toBe(2)
  })

  it('routes to the roles the rule names, and the owner counts as an admin', async () => {
    const lead = (
      await db.query<{ id: string }>(
        `insert into crm_leads (company_id, name, phone, assigned_to)
         values ('${COMPANY}', 'Routed Lead', '9000000004', '${REP}') returning id;`,
      )
    ).rows[0]!.id
    const wf = (
      await db.query<{ id: string }>(
        `insert into crm_workflows (company_id, name, trigger, notify_roles)
         values ('${COMPANY}', 'Escalate', 'lead_created', array['admin','manager']) returning id;`,
      )
    ).rows[0]!.id

    await act(wf, lead, { action: 'notify_assignee', step: 1 })
    const got = new Set((await sentBy(wf)).map((r) => r.recipient_uid))
    expect(got.has(REP)).toBe(true) // the assignee
    expect(got.has(MANAGER)).toBe(true) // role: manager
    expect(got.has(OWNER)).toBe(true) // role: admin, via super_admin
  })

  it('notify_assignee false reaches the roles only', async () => {
    const lead = (
      await db.query<{ id: string }>(
        `insert into crm_leads (company_id, name, phone, assigned_to)
         values ('${COMPANY}', 'Managers Only', '9000000005', '${REP}') returning id;`,
      )
    ).rows[0]!.id
    const wf = (
      await db.query<{ id: string }>(
        `insert into crm_workflows (company_id, name, trigger, notify_assignee, notify_roles)
         values ('${COMPANY}', 'Managers only', 'lead_created', false, array['manager']) returning id;`,
      )
    ).rows[0]!.id

    await act(wf, lead, { action: 'notify_assignee', step: 1 })
    const got = new Set((await sentBy(wf)).map((r) => r.recipient_uid))
    expect(got.has(REP)).toBe(false)
    expect(got.has(MANAGER)).toBe(true)
  })
})

describe('cadence filters', () => {
  it('a workflow does not start a cadence written for another source', async () => {
    const cadence = (
      await db.query<{ id: string }>(
        `insert into crm_cadences (company_id, name, source_filter)
         values ('${COMPANY}', 'Instagram nurture', 'instagram') returning id;`,
      )
    ).rows[0]!.id
    await db.exec(
      `insert into crm_cadence_steps (cadence_id, company_id, step_no, day_offset, note)
       values ('${cadence}', '${COMPANY}', 1, 0, 'Say hello');`,
    )
    const wf = (
      await db.query<{ id: string }>(
        `insert into crm_workflows (company_id, name, trigger)
         values ('${COMPANY}', 'Start nurture', 'lead_created') returning id;`,
      )
    ).rows[0]!.id

    const wrong = (
      await db.query<{ id: string }>(
        `insert into crm_leads (company_id, name, phone, source)
         values ('${COMPANY}', 'Referral Lead', '9000000006', 'referral') returning id;`,
      )
    ).rows[0]!.id
    await act(wf, wrong, { action: 'start_cadence', cadence_id: cadence, step: 1 })
    const none = await db.query(`select 1 from crm_lead_cadences where lead_id = '${wrong}';`)
    expect(none.rows.length).toBe(0)

    const right = (
      await db.query<{ id: string }>(
        `insert into crm_leads (company_id, name, phone, source)
         values ('${COMPANY}', 'Instagram Lead', '9000000007', 'instagram') returning id;`,
      )
    ).rows[0]!.id
    await act(wf, right, { action: 'start_cadence', cadence_id: cadence, step: 1 })
    const started = await db.query(`select 1 from crm_lead_cadences where lead_id = '${right}';`)
    expect(started.rows.length).toBe(1)
  })

  it('an unfiltered cadence still applies to everyone', async () => {
    const cadence = (
      await db.query<{ id: string }>(
        `insert into crm_cadences (company_id, name) values ('${COMPANY}', 'General') returning id;`,
      )
    ).rows[0]!.id
    await db.exec(
      `insert into crm_cadence_steps (cadence_id, company_id, step_no, day_offset, note)
       values ('${cadence}', '${COMPANY}', 1, 0, 'Check in');`,
    )
    const lead = (
      await db.query<{ id: string }>(
        `insert into crm_leads (company_id, name, phone, source)
         values ('${COMPANY}', 'Anyone', '9000000008', 'webform') returning id;`,
      )
    ).rows[0]!.id
    const wf = (
      await db.query<{ id: string }>(
        `insert into crm_workflows (company_id, name, trigger)
         values ('${COMPANY}', 'Start general', 'lead_created') returning id;`,
      )
    ).rows[0]!.id

    await act(wf, lead, { action: 'start_cadence', cadence_id: cadence, step: 1 })
    const started = await db.query(`select 1 from crm_lead_cadences where lead_id = '${lead}';`)
    expect(started.rows.length).toBe(1)
  })
})

describe('the workflow read query', () => {
  it('returns the four settings, so the editor cannot show defaults over them', async () => {
    // selectWorkflows in services/api/src/modules/crm/workflows.ts, trimmed to
    // the columns that matter here. It used to omit all four: the editor then
    // showed the contract defaults, and saving wrote those back — quietly
    // downgrading a seeded 'critical' rule to 'info' on the first edit.
    const wf = (
      await db.query<{ id: string }>(
        `insert into crm_workflows (company_id, name, trigger, severity, cooldown_hours, notify_assignee, notify_roles)
         values ('${COMPANY}', 'Round trip', 'lead_created', 'critical', 2, false, array['manager'])
         returning id;`,
      )
    ).rows[0]!.id

    const row = (
      await db.query<{
        severity: string
        cooldown_hours: number
        notify_assignee: boolean
        notify_roles: string[]
      }>(
        `select w.id, w.name, w.trigger, w.condition, w.is_active, w.allow_reenroll, w.exit_on_reply,
                w.severity, w.cooldown_hours, w.notify_assignee, w.notify_roles
           from crm_workflows w where w.id = '${wf}';`,
      )
    ).rows[0]!

    expect(row.severity).toBe('critical')
    expect(Number(row.cooldown_hours)).toBe(2)
    expect(row.notify_assignee).toBe(false)
    expect(row.notify_roles).toEqual(['manager'])
  })
})
