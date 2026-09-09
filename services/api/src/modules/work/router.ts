import { Hono } from 'hono'
import { z } from '@ipc/contracts'
import {
  reviewWorkRequest,
  submitWorkRequest,
  updateWorkSubmissionRequest,
  workReminderSettings,
  updateWorkReminderSettingsRequest,
  workSubmission,
} from '@ipc/contracts'
import type { AppEnv } from '../../context'
import { requireAuth } from '../../middleware/auth'
import { requireAction, requireOwner } from '../../middleware/permissions'
import { fail } from '../../middleware/errors'
import { uuidParam } from '../../lib/params'
import { withUser } from '../../lib/db'
import { attempt } from '../../lib/attempt'
import { audit } from '../../lib/audit'
import { rpcJson } from '../../lib/rpc'

const list = workSubmission.array()
const deliverResponse = z.object({ token: z.string() })

export const workRouter = new Hono<AppEnv>()
  .use('*', requireAuth)

  // Any active member: RLS returns their own submissions (+ all for admin/manager).
  // `user_id` narrows to one person's — RLS still caps a non-admin to their own
  // regardless of what they pass, so this is a display filter, not a grant.
  .get('/submissions', async (c) => {
    const userId = c.req.query('user_id')
    const uc = userId ? z.string().uuid().safeParse(userId) : null
    if (userId && !uc?.success) fail(422, 'Invalid user id.')
    const rows = await attempt(c, 'work.list', () =>
      withUser(
        c.env,
        c.get('auth').userId,
        (sql) =>
          sql`select id, project_id, task_id, submission_link, location_note, notes, status, review_notes, created_at
              from team_work_submissions
              where ${userId ? sql`submitted_by = ${userId}` : sql`true`}
              order by created_at desc`,
      ),
    )
    if (!rows) fail(400, 'We could not load submissions.')
    return c.json(list.parse(rows))
  })

  .post('/submissions', async (c) => {
    const parsed = submitWorkRequest.safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success) fail(422, 'Please add a link to your work.')
    const id = await attempt(c, 'work.submit', () =>
      withUser(c.env, c.get('auth').userId, async (sql) => {
        const rows = await sql<{ id: string }[]>`
          select submit_work(
            p_task_id => ${parsed.data.task_id},
            p_project_id => ${parsed.data.project_id},
            p_link => ${parsed.data.submission_link},
            p_notes => ${parsed.data.notes ?? null},
            p_location_note => ${parsed.data.location_note ?? null}
          ) as id`
        return rows[0]?.id ?? null
      }),
    )
    if (!id) fail(400, 'We could not submit your work.')
    await audit(c, { action: 'work.submit', entityType: 'work_submission', entityId: id, after: { task_id: parsed.data.task_id, project_id: parsed.data.project_id } })
    return c.json({ id }, 201)
  })

  // The RPC itself checks the caller is the submitter (or an admin/manager)
  // and refuses once the submission has been reviewed.
  .patch('/submissions/:id', async (c) => {
    const parsed = updateWorkSubmissionRequest.safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success) fail(422, 'Please add a link to your work.')
    const id = uuidParam(c)
    const ok = await attempt(
      c,
      'work.update',
      () =>
        withUser(c.env, c.get('auth').userId, async (sql) => {
          await sql`select update_work_submission(
            p_submission_id => ${id},
            p_link => ${parsed.data.submission_link},
            p_notes => ${parsed.data.notes ?? null},
            p_location_note => ${parsed.data.location_note ?? null}
          )`
          return true
        }),
      { onCode: (code) => (code === '23514' ? 'reviewed' : undefined) },
    )
    if (ok === 'reviewed') fail(409, 'This submission has already been reviewed and can no longer be edited.')
    if (!ok) fail(400, 'We could not update this submission.')
    await audit(c, { action: 'work.update', entityType: 'work_submission', entityId: id, after: parsed.data })
    return c.body(null, 204)
  })

  .post('/submissions/:id/review', requireAction('team_work_preview', 'edit'), async (c) => {
    const parsed = reviewWorkRequest.safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success) fail(422, 'Invalid review.')
    const id = uuidParam(c)
    const ok = await attempt(c, 'work.review', () =>
      withUser(c.env, c.get('auth').userId, async (sql) => {
        await sql`
          select review_work(
            p_submission_id => ${id},
            p_approve => ${parsed.data.approve},
            p_review_notes => ${parsed.data.review_notes ?? null}
          )`
        return true
      }),
    )
    if (!ok) fail(400, 'We could not record the review.')
    await audit(c, { action: parsed.data.approve ? 'work.approve' : 'work.reject', entityType: 'work_submission', entityId: id, after: parsed.data })
    return c.body(null, 204)
  })

  .post('/submissions/:id/deliver', requireAction('team_work_preview', 'edit'), async (c) => {
    const id = uuidParam(c)
    const token = await attempt(c, 'work.deliver', () =>
      withUser(c.env, c.get('auth').userId, async (sql) => {
        const rows = await sql<{ token: string | null }[]>`
          select deliver_work_to_client(
            p_submission_id => ${id},
            p_channel => ${'email'},
            p_ttl_hours => ${168}
          ) as token`
        return rows[0]?.token ?? null
      }),
    )
    if (!token) fail(400, 'The submission must be approved before delivery.')
    await audit(c, { action: 'work.deliver', entityType: 'work_submission', entityId: id })
    return c.json(deliverResponse.parse({ token }))
  })

/**
 * Owner-only: when a team member is nudged to submit pending work, and how
 * many days before the task's due date. Read by anyone active; only the
 * owner can change it, matching crm_settings' shape.
 */
export const workReminderSettingsRouter = new Hono<AppEnv>()
  .use('*', requireAuth)
  .get('/', async (c) => {
    const row = await attempt(c, 'work.reminder_settings.get', () =>
      withUser(c.env, c.get('auth').userId, async (sql) => {
        const rows = await sql<{ get_work_submission_reminder_settings: unknown }[]>`
          select get_work_submission_reminder_settings() as get_work_submission_reminder_settings`
        return rows[0]?.get_work_submission_reminder_settings ?? null
      }),
    )
    if (!row) fail(400, 'We could not load reminder settings.')
    return c.json(workReminderSettings.parse(rpcJson(row, {})))
  })

  .patch('/', requireOwner(), async (c) => {
    const parsed = updateWorkReminderSettingsRequest.safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success) fail(422, 'Please check the reminder settings.')
    const ok = await attempt(c, 'work.reminder_settings.update', () =>
      withUser(c.env, c.get('auth').userId, async (sql) => {
        await sql`select set_work_submission_reminder_settings(
          p_enabled => ${parsed.data.enabled}, p_reminder_days => ${parsed.data.reminder_days}::int[])`
        return true
      }),
    )
    if (!ok) fail(400, 'We could not save reminder settings.')
    await audit(c, { action: 'work_reminder_settings.update', entityType: 'company', entityId: c.get('auth').companyId, after: parsed.data })
    return c.body(null, 204)
  })
