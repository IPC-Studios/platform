import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import { beforeAll, beforeEach, describe, expect, it } from 'vitest'

/**
 * Does the CRM automation actually DO anything?
 *
 * The chain is long and invisible from the app: a lead is inserted, a row
 * trigger enrols it in every matching workflow and runs the first step there
 * and then, a delay step schedules the rest, and the hourly cron picks those
 * up through run_crm_followup_cron -> crm_run_workflows -> crm_run_enrollment
 * -> crm_workflow_do_action.
 *
 * Existing tests cover links. Nothing walked the whole thing — which is how
 * the v3 rule engine sat orphaned for months reading fine at every layer.
 *
 * So these start at "a lead arrives" and end at an effect a studio would see
 * on the lead itself, not at a summary counter saying something ran.
 */
const migDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'migrations')

const OWNER = '11111111-1111-1111-1111-111111111111'
const COMPANY = '22222222-2222-2222-2222-222222222222'

let db: PGlite
const q = async <T>(sql: string) => (await db.query<T>(sql)).rows
const one = async <T>(sql: string) => (await q<T>(sql))[0]

/** The hourly tick, exactly as the cron route calls it. */
const tick = async () =>
  (await one<{ j: Record<string, Record<string, number>> }>(
    `select run_crm_followup_cron(p_dry_run => false) as j;`,
  ))!.j

/** Our own workflow's enrollment — the studio has seeded defaults too. */
const mine = async (wf: string) =>
  await one<{ status: string; current_step: number; next_at: string | null }>(
    `select status, current_step, next_at from crm_workflow_enrollments where workflow_id = '${wf}';`,
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
  `)
  await db.exec(`set request.jwt.claim.sub = '${OWNER}';`)
})

beforeEach(async () => {
  await db.exec(`delete from crm_workflow_enrollments;`)
  await db.exec(`delete from crm_lead_events;`)
  await db.exec(`delete from crm_leads;`)
  // The studio's seeded defaults stay; only what each test builds is cleared.
  await db.exec(`delete from crm_workflow_steps where workflow_id in
                   (select id from crm_workflows where name in ('Welcome', 'Drip'));`)
  await db.exec(`delete from crm_workflows where name in ('Welcome', 'Drip');`)
})

/** A workflow that fires on lead creation, with the steps given. */
async function workflow(name: string, steps: { kind: string; config: Record<string, unknown> }[]) {
  const wf = (await one<{ id: string }>(`
    insert into crm_workflows (company_id, name, trigger, is_active)
    values ('${COMPANY}', '${name}', 'lead_created', true) returning id;`))!.id
  for (const [i, s] of steps.entries()) {
    await db.exec(`
      insert into crm_workflow_steps (company_id, workflow_id, step_no, kind, config)
      values ('${COMPANY}', '${wf}', ${i + 1}, '${s.kind}', '${JSON.stringify(s.config)}'::jsonb);`)
  }
  return wf
}

let seq = 0
const addLead = async () =>
  (await one<{ id: string }>(`
    insert into crm_leads (company_id, name, phone, source)
    values ('${COMPANY}', 'Walk-in ${++seq}', '90000${100000 + seq}', 'instagram')
    returning id;`))!.id

const notesOn = async (lead: string) =>
  (await one<{ notes: string | null }>(`select notes from crm_leads where id = '${lead}';`))!.notes ?? ''

describe('a lead arriving sets the machinery going', () => {
  it('enrols it, and the first action takes effect immediately', async () => {
    const wf = await workflow('Welcome', [
      { kind: 'action', config: { action: 'add_note', note: 'Say hello' } },
    ])
    const lead = await addLead()
    // The step runs inside the row trigger, so the effect is on the lead
    // before anyone refreshes anything. Empty here means every workflow in
    // the studio is decoration.
    expect(await notesOn(lead)).toContain('Say hello')
    expect((await mine(wf))!.status).toBe('completed')
  })

  it('writes the run onto the lead’s own history', async () => {
    await workflow('Welcome', [{ kind: 'action', config: { action: 'add_note', note: 'hi' } }])
    const lead = await addLead()
    const events = await q<{ note: string }>(
      `select note from crm_lead_events where lead_id = '${lead}';`,
    )
    // Otherwise the automation is invisible even when it works, and nobody
    // can tell why a lead changed.
    expect(events.map((e) => e.note).join(' ')).toMatch(/workflow.*Welcome/i)
  })

  it('does not enrol in a workflow that is switched off', async () => {
    const wf = await workflow('Welcome', [{ kind: 'action', config: { action: 'add_note', note: 'zzz' } }])
    await db.exec(`update crm_workflows set is_active = false where id = '${wf}';`)
    const lead = await addLead()
    expect(await mine(wf)).toBeUndefined()
    expect(await notesOn(lead)).not.toContain('zzz')
  })

  it('a delay holds the next step back instead of running it at once', async () => {
    const wf = await workflow('Drip', [
      { kind: 'delay', config: { amount: 2, unit: 'days' } },
      { kind: 'action', config: { action: 'add_note', note: 'later' } },
    ])
    const lead = await addLead()
    const e = await mine(wf)
    expect(e!.status).toBe('active')
    expect(new Date(e!.next_at!).getTime()).toBeGreaterThan(Date.now())
    // The point of a drip: the second step has NOT happened yet.
    expect(await notesOn(lead)).not.toContain('later')
  })

  it('the hourly tick runs what has come due, and the action lands', async () => {
    const wf = await workflow('Drip', [
      { kind: 'delay', config: { amount: 2, unit: 'days' } },
      { kind: 'action', config: { action: 'add_note', note: 'later' } },
    ])
    const lead = await addLead()
    await db.exec(`update crm_workflow_enrollments set next_at = now() - interval '1 minute'
                    where workflow_id = '${wf}';`)
    const summary = await tick()
    expect(summary['workflows']!['ran']).toBeGreaterThan(0)
    expect(summary['workflows']!['errored']).toBe(0)
    // The whole chain, proven at the far end: the note the studio configured
    // is on the lead.
    expect(await notesOn(lead)).toContain('later')
    expect((await mine(wf))!.status).toBe('completed')
  })

  it('does not run the same step twice on the next tick', async () => {
    const wf = await workflow('Drip', [
      { kind: 'delay', config: { amount: 1, unit: 'days' } },
      { kind: 'action', config: { action: 'add_note', note: 'once' } },
    ])
    const lead = await addLead()
    await db.exec(`update crm_workflow_enrollments set next_at = now() - interval '1 minute'
                    where workflow_id = '${wf}';`)
    await tick()
    const after = await notesOn(lead)
    await tick()
    // The cron runs hourly for ever. A step that re-fires is a client getting
    // the same message every hour until somebody notices.
    expect(await notesOn(lead)).toBe(after)
  })

  it('a dry run reports what is due without advancing anything', async () => {
    const wf = await workflow('Drip', [
      { kind: 'delay', config: { amount: 1, unit: 'days' } },
      { kind: 'action', config: { action: 'add_note', note: 'dryrun' } },
    ])
    const lead = await addLead()
    await db.exec(`update crm_workflow_enrollments set next_at = now() - interval '1 minute'
                    where workflow_id = '${wf}';`)
    const before = await mine(wf)
    await db.query(`select run_crm_followup_cron(p_dry_run => true);`)
    expect((await mine(wf))!.current_step).toBe(before!.current_step)
    expect(await notesOn(lead)).not.toContain('dryrun')
  })

  it('scores the lead on arrival', async () => {
    const lead = await addLead()
    const l = await one<{ score: number | null }>(`select score from crm_leads where id = '${lead}';`)
    expect(l!.score).not.toBeNull()
  })

  it('every action the editor offers actually changes something', async () => {
    // A configurable action that silently no-ops is the worst kind: the studio
    // builds the rule, the UI saves it, and nothing ever happens.
    const lead = await addLead()
    const wf = await workflow('Welcome', [{ kind: 'action', config: { action: 'add_note', note: 'x' } }])
    const cases: [string, Record<string, unknown>, string][] = [
      ['mark_hot', {}, `select is_hot as v from crm_leads where id = '${lead}'`],
      ['set_follow_up_days', { days: 3 }, `select (follow_up_at is not null) as v from crm_leads where id = '${lead}'`],
      ['add_note', { note: 'noted' }, `select (notes ilike '%noted%') as v from crm_leads where id = '${lead}'`],
    ]
    for (const [action, cfg, check] of cases) {
      await db.query(`select crm_workflow_do_action(
          (select l from crm_leads l where l.id = '${lead}'),
          '${JSON.stringify({ action, ...cfg })}'::jsonb,
          (select w from crm_workflows w where w.id = '${wf}'));`)
      expect((await one<{ v: boolean }>(check))!.v, action).toBe(true)
    }
  })
})
