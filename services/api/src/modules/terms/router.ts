import { Hono } from 'hono'
import { z } from '@ipc/contracts'
import type { AppEnv } from '../../context'
import { requireAuth } from '../../middleware/auth'
import { requireAction } from '../../middleware/permissions'
import { fail } from '../../middleware/errors'
import { textParam } from '../../lib/params'
import { withService, withUser } from '../../lib/db'
import { attempt } from '../../lib/attempt'
import { audit } from '../../lib/audit'
import { resolveClientIp } from '../../lib/client-ip'

const issueTermsRequest = z.object({
  project_id: z.string().uuid().nullable().default(null),
  rendered_body: z.string().min(1),
})
const issueTermsResponse = z.object({ document_id: z.string().uuid(), token: z.string() })
const termsBody = z.object({ body: z.string() })
const ackRequest = z.object({ name: z.string().trim().min(1).max(160), email: z.string().max(200).optional() })

/** One row per project: its most recent terms document and whether it's been agreed to. */
const termsDocument = z.object({
  id: z.string().uuid(),
  project_id: z.string().uuid().nullable(),
  project_name: z.string().nullable(),
  client_name: z.string().nullable(),
  client_phone: z.string().nullable(),
  acknowledged_at: z.string().nullable(),
  acknowledged_by_name: z.string().nullable(),
  has_active_link: z.boolean(),
  link_expires_at: z.string().nullable(),
  created_at: z.string(),
})
const termsDocumentList = termsDocument.array()

/** Studio side: issue a terms document + client acknowledgement link. */
export const termsRouter = new Hono<AppEnv>()
  .use('*', requireAuth)

  // The dashboard: every project's paperwork, one row each, newest document
  // first per project. `distinct on` picks that latest row without a second
  // query per project.
  .get('/documents', requireAction('projects', 'view'), async (c) => {
    const rows = await attempt(c, 'terms.documents', () =>
      withUser(c.env, c.get('auth').userId, (sql) => sql`select * from list_project_terms_documents()`),
    )
    if (!rows) fail(400, 'We could not load project documents.')
    return c.json(termsDocumentList.parse(rows))
  })

  .post('/issue', requireAction('projects', 'edit'), async (c) => {
    const parsed = issueTermsRequest.safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success) fail(422, 'Terms text is required.')
    const row = await attempt(c, 'terms.issue', () =>
      withUser(c.env, c.get('auth').userId, async (sql) => {
        const rows = await sql<{ document_id: string; token: string }[]>`
          select * from issue_terms_document(
            p_project_id => ${parsed.data.project_id},
            p_rendered_body => ${parsed.data.rendered_body}
          )`
        return rows[0] ?? null
      }),
    )
    if (!row) fail(400, 'We could not create the document.')
    await audit(c, {
      action: 'terms.issue',
      entityType: 'terms_document',
      entityId: row.document_id,
      after: { project_id: parsed.data.project_id },
    })
    return c.json(issueTermsResponse.parse(row), 201)
  })

/** PUBLIC (no auth): client views + acknowledges terms by token. */
export const publicTermsRouter = new Hono<AppEnv>()
  .get('/terms/:token', async (c) => {
    const token = textParam(c, 'token', 400)
    const rows = await attempt(c, 'terms.public_get', () =>
      withService(c.env, (sql) => sql<{ body: string | null }[]>`select get_terms_for_token(p_raw => ${token}) as body`),
    )
    if (!rows) fail(503, 'The service is temporarily unavailable. Please try again in a moment.')
    const body = rows[0]?.body
    if (!body) fail(404, 'This link is invalid or has expired.')
    return c.json(termsBody.parse({ body }))
  })

  .post('/terms/:token/ack', async (c) => {
    const parsed = ackRequest.safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success) fail(422, 'Please enter your name to agree.')
    const token = textParam(c, 'token', 400)
    const ip = resolveClientIp(c.req.raw.headers, c.env.CLIENT_IP_HEADER)
    const ua = c.req.header('User-Agent') ?? null
    const rows = await attempt(c, 'terms.public_ack', () =>
      withService(
        c.env,
        (sql) => sql<{ ok: boolean }[]>`
          select acknowledge_terms(
            p_raw => ${token},
            p_name => ${parsed.data.name},
            p_email => ${parsed.data.email ?? null},
            p_ip => ${ip === 'unknown' ? null : ip},
            p_user_agent => ${ua}
          ) as ok`,
      ),
    )
    if (!rows) fail(400, 'We could not record your agreement.')
    if (rows[0]?.ok === false) fail(409, 'This link has already been used or has expired.')
    return c.json({ ok: true })
  })
