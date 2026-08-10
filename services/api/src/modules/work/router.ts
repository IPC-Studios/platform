import { Hono } from 'hono'
import { z } from '@ipc/contracts'
import { reviewWorkRequest, submitWorkRequest, workSubmission } from '@ipc/contracts'
import type { AppEnv } from '../../context'
import { requireAuth } from '../../middleware/auth'
import { requireAction } from '../../middleware/permissions'
import { fail } from '../../middleware/errors'
import { withUser } from '../../lib/db'

const list = workSubmission.array()

export const workRouter = new Hono<AppEnv>()
  .use('*', requireAuth)

  // Any active member: RLS returns their own submissions (+ all for admin/manager).
  .get('/submissions', async (c) => {
    const rows = await withUser(
      c.env,
      c.get('auth').userId,
      (sql) =>
        sql`select id, project_id, task_id, submission_link, notes, status, review_notes, created_at
            from team_work_submissions
            order by created_at desc`,
    ).catch(() => null)
    if (!rows) fail(400, 'We could not load submissions.')
    return c.json(list.parse(rows ?? []))
  })

  .post('/submissions', async (c) => {
    const parsed = submitWorkRequest.safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success) fail(422, 'Please add a link to your work.')
    const id = await withUser(c.env, c.get('auth').userId, async (sql) => {
      const rows = await sql`
        select submit_work(
          p_task_id => ${parsed.data.task_id},
          p_project_id => ${parsed.data.project_id},
          p_link => ${parsed.data.submission_link},
          p_notes => ${parsed.data.notes ?? null}
        ) as id`
      return rows[0]?.id as string | undefined
    }).catch(() => null)
    if (!id) fail(400, 'We could not submit your work.')
    return c.json({ id: id as string }, 201)
  })

  .post('/submissions/:id/review', requireAction('team_work_preview', 'edit'), async (c) => {
    const parsed = reviewWorkRequest.safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success) fail(422, 'Invalid review.')
    const ok = await withUser(c.env, c.get('auth').userId, async (sql) => {
      await sql`
        select review_work(
          p_submission_id => ${c.req.param('id')!},
          p_approve => ${parsed.data.approve},
          p_review_notes => ${parsed.data.review_notes ?? null}
        )`
      return true
    }).catch(() => false)
    if (!ok) fail(400, 'We could not record the review.')
    return c.body(null, 204)
  })

  .post('/submissions/:id/deliver', requireAction('team_work_preview', 'edit'), async (c) => {
    const token = await withUser(c.env, c.get('auth').userId, async (sql) => {
      const rows = await sql`
        select deliver_work_to_client(
          p_submission_id => ${c.req.param('id')!},
          p_channel => ${'email'},
          p_ttl_hours => ${168}
        ) as token`
      return rows[0]?.token as string | undefined
    }).catch(() => null)
    if (!token) fail(400, 'The submission must be approved before delivery.')
    return c.json(z.object({ token: z.string() }).parse({ token: token as string }))
  })
