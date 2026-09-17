import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import { beforeAll, beforeEach, describe, expect, it } from 'vitest'

/**
 * A cadence is a promise to keep chasing.
 *
 * The studio puts a lead on "call day 0, day 2, day 7", and from then on the
 * only thing standing between that plan and a forgotten lead is the hourly
 * sweep. If the sweep does not move the step on, the lead sits on step 1 for
 * ever and the follow-up date never changes — which looks exactly like a
 * cadence that is working, because there IS a date on the lead.
 *
 * So these check the step number moved and the lead's follow_up_at moved with
 * it, not just that the sweep ran.
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
const lead = async (name: string, assignee: string | null = OWNER) =>
  (await one<{ id: string }>(`
    insert into crm_leads (company_id, name, phone, source, assigned_to)
    values ('${COMPANY}', '${name}', '98${500000 + ++seq}', 'instagram',
            ${assignee ? `'${assignee}'` : 'null'})
    returning id;`))!.id

/** A cadence with one step per day offset given. */
const cadence = async (name: string, offsets: number[]) => {
  const id = (await one<{ id: string }>(`
    insert into crm_cadences (company_id, name, is_active) values ('${COMPANY}', '${name}', true)
    returning id;`))!.id
  for (const [i, day] of offsets.entries()) {
    await db.exec(`
      insert into crm_cadence_steps (company_id, cadence_id, step_no, day_offset, note)
      values ('${COMPANY}', '${id}', ${i + 1}, ${day}, 'Step ${i + 1}: ring them');`)
  }
  return id
}

const enrolment = async (leadId: string) =>
  await one<{ step_no: number; next_at: string | null; completed_at: string | null; stopped_at: string | null }>(
    `select step_no, next_at, completed_at, stopped_at from crm_lead_cadences where lead_id = '${leadId}';`,
  )

/** Pull the whole cadence forward so the next step is due now. */
const makeDue = async (leadId: string) =>
  await db.exec(`update crm_lead_cadences set next_at = now() - interval '1 minute' where lead_id = '${leadId}';`)

const tick = async () =>
  (await one<{ j: Record<string, Record<string, number>> }>(
    `select run_crm_followup_cron(p_dry_run => false) as j;`,
  ))!.j

beforeEach(async () => {
  await db.exec(`delete from crm_lead_cadences;`)
  await db.exec(`delete from crm_lead_events;`)
  await db.exec(`delete from notifications;`)
  await db.exec(`delete from crm_leads;`)
  await db.exec(`delete from crm_cadence_steps;`)
  await db.exec(`delete from crm_cadences;`)
})

describe('putting a lead on a cadence', () => {
  it('starts it on step one and sets the follow-up', async () => {
    const c = await cadence('Wedding chase', [0, 2, 7])
    const id = await lead('Aarav Mehta')
    await db.query(`select start_lead_cadence('${id}'::uuid, '${c}'::uuid);`)

    const e = await enrolment(id)
    expect(e!.step_no).toBe(1)
    expect(e!.next_at).not.toBeNull()
    const l = await one<{ follow_up_at: Date | null }>(
      `select follow_up_at from crm_leads where id = '${id}';`,
    )
    // The cadence date and the lead's own follow-up date have to be the same
    // instant, or the list and the cadence disagree about when to call.
    expect(l!.follow_up_at!.getTime()).toBe(e!.next_at!.getTime())
  })

  it('will not start a cadence that has no steps', async () => {
    const c = (await one<{ id: string }>(`
      insert into crm_cadences (company_id, name, is_active) values ('${COMPANY}', 'Empty', true)
      returning id;`))!.id
    const id = await lead('Aarav Mehta')
    // An empty cadence would enrol the lead and then never fire, which is
    // worse than refusing: the lead looks chased.
    await expect(
      db.query(`select start_lead_cadence('${id}'::uuid, '${c}'::uuid);`),
    ).rejects.toThrow(/no steps/i)
    expect(await enrolment(id)).toBeUndefined()
  })

  it('will not start a switched-off cadence', async () => {
    const c = await cadence('Retired', [0, 3])
    await db.exec(`update crm_cadences set is_active = false where id = '${c}';`)
    const id = await lead('Aarav Mehta')
    await expect(
      db.query(`select start_lead_cadence('${id}'::uuid, '${c}'::uuid);`),
    ).rejects.toThrow(/unknown cadence/i)
  })

  it('the sweep moves it to the next step and moves the follow-up with it', async () => {
    const c = await cadence('Wedding chase', [0, 2, 7])
    const id = await lead('Aarav Mehta')
    await db.query(`select start_lead_cadence('${id}'::uuid, '${c}'::uuid);`)
    await makeDue(id)

    const s = await tick()
    expect(s['cadences']!['due']).toBe(1)
    expect(s['cadences']!['advanced']).toBe(1)

    const e = await enrolment(id)
    // The whole point: step 1 is done, step 2 is scheduled. A sweep that
    // notified and left step_no alone would notify again every hour.
    expect(e!.step_no).toBe(2)
    const l = await one<{ follow_up_at: Date | null }>(
      `select follow_up_at from crm_leads where id = '${id}';`,
    )
    expect(l!.follow_up_at!.getTime()).toBe(e!.next_at!.getTime())
  })

  it('tells the assignee the step is due, and says which step', async () => {
    const c = await cadence('Wedding chase', [0, 2])
    const id = await lead('Aarav Mehta')
    await db.query(`select start_lead_cadence('${id}'::uuid, '${c}'::uuid);`)
    await makeDue(id)
    await tick()
    const n = await q<{ title: string; body: string | null }>(
      `select title, body from notifications where recipient_uid = '${OWNER}' and type = 'crm_cadence';`,
    )
    expect(n.length).toBe(1)
    // The note the studio wrote on the step is the instruction — without it
    // the notification says only "something is due".
    expect(`${n[0]!.title} ${n[0]!.body ?? ''}`).toMatch(/ring them/i)
  })

  it('completes after the last step instead of looping', async () => {
    const c = await cadence('Two touches', [0, 1])
    const id = await lead('Aarav Mehta')
    await db.query(`select start_lead_cadence('${id}'::uuid, '${c}'::uuid);`)
    await makeDue(id)
    await tick()
    await makeDue(id)
    const s = await tick()

    expect(s['cadences']!['completed']).toBe(1)
    const e = await enrolment(id)
    expect(e!.completed_at).not.toBeNull()
    expect(e!.next_at).toBeNull()

    // And a third tick finds nothing — a completed cadence that stayed due
    // would chase the client for ever.
    const s3 = await tick()
    expect(s3['cadences']!['due']).toBe(0)
  })

  it('stopping it stops the chasing', async () => {
    const c = await cadence('Wedding chase', [0, 2])
    const id = await lead('Aarav Mehta')
    await db.query(`select start_lead_cadence('${id}'::uuid, '${c}'::uuid);`)
    const ok = await one<{ stop_lead_cadence: boolean }>(
      `select stop_lead_cadence('${id}'::uuid) as stop_lead_cadence;`,
    )
    expect(ok!.stop_lead_cadence).toBe(true)
    await makeDue(id)
    const s = await tick()
    expect(s['cadences']!['due']).toBe(0)
    expect((await enrolment(id))!.stopped_at).not.toBeNull()
  })

  it('says so when there is no cadence to stop', async () => {
    const id = await lead('Aarav Mehta')
    const ok = await one<{ stop_lead_cadence: boolean }>(
      `select stop_lead_cadence('${id}'::uuid) as stop_lead_cadence;`,
    )
    // The route turns this false into a 404. A true here would have the UI
    // report a cadence stopped that never existed.
    expect(ok!.stop_lead_cadence).toBe(false)
  })

  it('winning the lead stops the cadence on its own', async () => {
    const c = await cadence('Wedding chase', [0, 2, 7])
    const id = await lead('Aarav Mehta')
    await db.query(`select start_lead_cadence('${id}'::uuid, '${c}'::uuid);`)
    await db.exec(`update crm_leads set status = 'converted' where id = '${id}';`)
    // Chasing a client who has already booked is the most embarrassing thing
    // an automation can do.
    expect((await enrolment(id))!.stopped_at).not.toBeNull()
    await makeDue(id)
    expect((await tick())['cadences']!['due']).toBe(0)
  })

  it('losing the lead stops it too', async () => {
    const c = await cadence('Wedding chase', [0, 2])
    const id = await lead('Aarav Mehta')
    await db.query(`select start_lead_cadence('${id}'::uuid, '${c}'::uuid);`)
    // A lost lead must say why — the product enforces it, so the fixture does too.
    await db.exec(`update crm_leads set status = 'lost', lost_reason = 'Went elsewhere' where id = '${id}';`)
    expect((await enrolment(id))!.stopped_at).not.toBeNull()
  })

  it('starting a second cadence replaces the first rather than running both', async () => {
    const a = await cadence('Gentle', [0, 5])
    const b = await cadence('Hard sell', [0, 1])
    const id = await lead('Aarav Mehta')
    await db.query(`select start_lead_cadence('${id}'::uuid, '${a}'::uuid);`)
    await db.query(`select start_lead_cadence('${id}'::uuid, '${b}'::uuid);`)
    const rows = await q(`select 1 from crm_lead_cadences where lead_id = '${id}';`)
    // Two live cadences would mean two notifications a day about one lead.
    expect(rows.length).toBe(1)
    const e = await one<{ cadence_id: string; step_no: number; stopped_at: Date | null }>(
      `select cadence_id, step_no, stopped_at from crm_lead_cadences where lead_id = '${id}';`,
    )
    expect(e!.cadence_id).toBe(b)
    expect(e!.step_no).toBe(1)
    expect(e!.stopped_at).toBeNull()
  })

  it('a dry run reports what is due without advancing it', async () => {
    const c = await cadence('Wedding chase', [0, 2])
    const id = await lead('Aarav Mehta')
    await db.query(`select start_lead_cadence('${id}'::uuid, '${c}'::uuid);`)
    await makeDue(id)
    const s = (await one<{ j: Record<string, Record<string, number>> }>(
      `select run_crm_followup_cron(p_dry_run => true) as j;`,
    ))!.j
    expect(s['cadences']!['due']).toBe(1)
    expect(s['cadences']!['advanced']).toBe(0)
    expect((await enrolment(id))!.step_no).toBe(1)
  })

  it('writes each due step onto the lead’s timeline', async () => {
    const c = await cadence('Wedding chase', [0, 2])
    const id = await lead('Aarav Mehta')
    await db.query(`select start_lead_cadence('${id}'::uuid, '${c}'::uuid);`)
    await makeDue(id)
    await tick()
    const notes = (await q<{ note: string }>(`select note from crm_lead_events where lead_id = '${id}';`))
      .map((e) => e.note)
      .join(' | ')
    expect(notes).toMatch(/cadence started/i)
    expect(notes).toMatch(/step 1 due/i)
  })
})
