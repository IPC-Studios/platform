import { Hono } from 'hono'
import { attendanceSweepResult, cronRun, cronRunResult } from '@ipc/contracts'
import type { AppEnv } from '../../context'
import { fail } from '../../middleware/errors'
import { requireAuth } from '../../middleware/auth'
import { withService, withUser } from '../../lib/db'
import { attempt } from '../../lib/attempt'
import { timingSafeEqual } from '../../lib/crypto'
import { log } from '../../lib/log'
import { drainOutbox } from '../../lib/outbox'

/**
 * Cron ingress. Authenticated ONLY by a shared secret compared in constant
 * time. Generators are idempotent + support dry_run (?dry=1). No user context.
 *
 * The run history is readable by the studio owner (RLS: cron_runs_select_owner)
 * and by platform admins (cron_runs_select_platform), under a normal session.
 */
export const cronRouter = new Hono<AppEnv>()
  .post('/reminders', async (c) => {
    const provided = c.req.header('x-cron-secret') ?? ''
    const expected = c.env.CRON_SECRET ?? ''
    if (!expected || !timingSafeEqual(provided, expected)) fail(401, 'Unauthorized.')

    const dryRun = c.req.query('dry') === '1'
    const result = await attempt(c, 'cron.reminders', () =>
      withService(c.env, async (sql) => {
        const rows = await sql<{ summary: unknown }[]>`
          select run_reminder_cron(p_dry_run => ${dryRun}) as summary`
        const followUps = await sql<{ summary: unknown }[]>`
          select run_crm_followup_cron(p_dry_run => ${dryRun}) as summary`
        const workReminders = await sql<{ summary: unknown }[]>`
          select run_work_submission_reminder_cron(p_dry_run => ${dryRun}) as summary`
        // Rotation writes a refresh_tokens row every 30 minutes per active
        // user, so the table needs a sweep or it grows forever.
        const purged = dryRun
          ? 0
          : ((await sql<{ n: number }[]>`select purge_expired_refresh_tokens() as n`)[0]?.n ?? 0)
        // Workflows queue template sends; only the API can deliver them.
        const outbox = dryRun ? { claimed: 0, sent: 0, manual: 0, failed: 0 } : await drainOutbox(c.env, sql)
        // The quote sweep runs inside run_crm_followup_cron now, so its count
        // comes out of that summary. Calling it again here would expire a
        // second batch outside the dry run and double-report the first.
        const followUpSummary = (followUps[0]?.summary ?? {}) as { quotes?: { expired?: number } }
        const expiredQuotes = followUpSummary.quotes?.expired ?? 0
        return {
          summary: rows[0]?.summary ?? {},
          crm_follow_ups: followUpSummary,
          work_submission_reminders: workReminders[0]?.summary ?? {},
          crm_outbox: outbox,
          crm_expired_quotes: expiredQuotes,
          purged_refresh_tokens: purged,
        }
      }),
    )
    if (!result) fail(400, 'The job could not run.')
    log.info({ path: c.req.path, dryRun, ...result }, 'cron reminders ran')
    return c.json(cronRunResult.parse({ ok: true, ...result }))
  })

  /**
   * The nightly attendance sweep: every active member with no row for today
   * gets an `absent` one, in their own company's timezone.
   *
   * Its own endpoint, not part of the hourly job above, because it has to run
   * ONCE and after the working day. Marking everyone absent at 1am and
   * letting check-in flip them back would make any absence figure read
   * mid-day a lie. Schedule it the way the old app did: 30 18 * * * UTC,
   * which is midnight in Asia/Kolkata.
   *
   * Idempotent: `on conflict do nothing`, so a retried or doubled run writes
   * nothing the first one did not.
   */
  .post('/attendance', async (c) => {
    const provided = c.req.header('x-cron-secret') ?? ''
    const expected = c.env.CRON_SECRET ?? ''
    if (!expected || !timingSafeEqual(provided, expected)) fail(401, 'Unauthorized.')

    const dryRun = c.req.query('dry') === '1'
    const marked = await attempt(c, 'cron.attendance', () =>
      withService(c.env, async (sql) => {
        if (dryRun) {
          // What it WOULD write, counted the same way the function selects it.
          const rows = await sql<{ n: number }[]>`
            select count(*)::int as n
              from companies c
              join users u on u.company_id = c.id and u.deleted_at is null and u.status = 'active'
              left join company_location cl on cl.company_id = c.id
             where not exists (
               select 1 from attendance a
                where a.company_id = c.id and a.user_id = u.user_id
                  and a.a_date = (now() at time zone coalesce(cl.timezone, 'Asia/Kolkata'))::date
             )`
          return rows[0]?.n ?? 0
        }
        const rows = await sql<{ n: number }[]>`select mark_absent_backstop() as n`
        return rows[0]?.n ?? 0
      }),
    )
    if (marked === null) fail(400, 'The job could not run.')
    log.info({ path: c.req.path, dryRun, marked_absent: marked }, 'cron attendance ran')
    return c.json(attendanceSweepResult.parse({ ok: true, marked_absent: marked }))
  })

  .get('/runs', requireAuth, async (c) => {
    const limitRaw = Number(c.req.query('limit') ?? 50)
    const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(Math.trunc(limitRaw), 1), 200) : 50
    const auth = c.get('auth')
    if (!auth.isOwner && !auth.isPlatformAdmin) fail(403, 'You do not have access to this action.')
    const rows = await attempt(c, 'cron.runs', () =>
      withUser(
        c.env,
        auth.userId,
        (sql) => sql`
          select id, job_name, started_at, finished_at, dry_run, summary
          from cron_runs order by started_at desc limit ${limit}`,
      ),
    )
    if (!rows) fail(400, 'We could not load the job history.')
    return c.json(cronRun.array().parse(rows))
  })
