import { Hono } from 'hono'
import { z } from '@ipc/contracts'
import type { AppEnv } from '../../context'
import { requireAuth } from '../../middleware/auth'
import { requireAction } from '../../middleware/permissions'
import { fail } from '../../middleware/errors'
import { requestClient, serviceClient } from '../../lib/supabase'

/** Studio side: issue a terms document + client acknowledgement link. */
export const termsRouter = new Hono<AppEnv>()
  .use('*', requireAuth)
  .post('/issue', requireAction('projects', 'edit'), async (c) => {
    const body = await c.req.json().catch(() => ({}))
    const parsed = z
      .object({ project_id: z.string().uuid().nullable().default(null), rendered_body: z.string().min(1) })
      .safeParse(body)
    if (!parsed.success) fail(422, 'Terms text is required.')
    const { data, error } = await requestClient(c)
      .rpc('issue_terms_document', {
        p_project_id: parsed.data.project_id,
        p_rendered_body: parsed.data.rendered_body,
      })
      .single()
    if (error || !data) fail(400, 'We could not create the document.')
    const row = data as { document_id: string; token: string }
    return c.json({ document_id: row.document_id, token: row.token }, 201)
  })

/** PUBLIC (no auth): client views + acknowledges terms by token. */
export const publicTermsRouter = new Hono<AppEnv>()
  .get('/terms/:token', async (c) => {
    const { data, error } = await serviceClient(c.env)
      .rpc('get_terms_for_token', { p_raw: c.req.param('token') })
    if (error || !data) fail(404, 'This link is invalid or has expired.')
    return c.json({ body: data as string })
  })

  .post('/terms/:token/ack', async (c) => {
    const parsed = z
      .object({ name: z.string().trim().min(1), email: z.string().optional() })
      .safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success) fail(422, 'Please enter your name to agree.')
    const ip = c.req.header('CF-Connecting-IP') ?? c.req.header('X-Forwarded-For') ?? null
    const ua = c.req.header('User-Agent') ?? null
    const { data, error } = await serviceClient(c.env).rpc('acknowledge_terms', {
      p_raw: c.req.param('token'),
      p_name: parsed.data.name,
      p_email: parsed.data.email ?? null,
      p_ip: ip,
      p_user_agent: ua,
    })
    if (error) fail(400, 'We could not record your agreement.')
    if (data === false) fail(409, 'This link has already been used or has expired.')
    return c.json({ ok: true })
  })
