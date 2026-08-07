import { Hono } from 'hono'
import { z } from '@ipc/contracts'
import { reviewWorkRequest, submitWorkRequest, workSubmission } from '@ipc/contracts'
import type { AppEnv } from '../../context'
import { requireAuth } from '../../middleware/auth'
import { requireAction } from '../../middleware/permissions'
import { fail } from '../../middleware/errors'
import { requestClient } from '../../lib/supabase'

const list = workSubmission.array()
const SELECT = 'id,project_id,task_id,submission_link,notes,status,review_notes,created_at'

export const workRouter = new Hono<AppEnv>()
  .use('*', requireAuth)

  // Any active member: RLS returns their own submissions (+ all for admin/manager).
  .get('/submissions', async (c) => {
    const { data, error } = await requestClient(c)
      .from('team_work_submissions')
      .select(SELECT)
      .order('created_at', { ascending: false })
    if (error) fail(400, 'We could not load submissions.')
    return c.json(list.parse(data ?? []))
  })

  .post('/submissions', async (c) => {
    const parsed = submitWorkRequest.safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success) fail(422, 'Please add a link to your work.')
    const { data, error } = await requestClient(c).rpc('submit_work', {
      p_task_id: parsed.data.task_id,
      p_project_id: parsed.data.project_id,
      p_link: parsed.data.submission_link,
      p_notes: parsed.data.notes ?? null,
    })
    if (error || !data) fail(400, 'We could not submit your work.')
    return c.json({ id: data as string }, 201)
  })

  .post('/submissions/:id/review', requireAction('team_work_preview', 'edit'), async (c) => {
    const parsed = reviewWorkRequest.safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success) fail(422, 'Invalid review.')
    const { error } = await requestClient(c).rpc('review_work', {
      p_submission_id: c.req.param('id'),
      p_approve: parsed.data.approve,
      p_review_notes: parsed.data.review_notes ?? null,
    })
    if (error) fail(400, 'We could not record the review.')
    return c.body(null, 204)
  })

  .post('/submissions/:id/deliver', requireAction('team_work_preview', 'edit'), async (c) => {
    const { data, error } = await requestClient(c).rpc('deliver_work_to_client', {
      p_submission_id: c.req.param('id'),
      p_channel: 'email',
      p_ttl_hours: 168,
    })
    if (error) fail(400, 'The submission must be approved before delivery.')
    return c.json(z.object({ token: z.string() }).parse({ token: data as string }))
  })
