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
  // Lovable parity (additive): rich payload fields.
  title: z.string().trim().max(200).nullish(),
  payment_summary: z.string().trim().max(2000).nullish(),
  sections: z.array(z.record(z.string(), z.unknown())).nullish(),
  expiry_days: z.number().int().min(1).max(3650).nullish(),
})
const issueTermsResponse = z.object({ document_id: z.string().uuid(), token: z.string() })
const termsBody = z.object({ body: z.string() })
// Lovable parity: rich payload (title/project/client/company/payment/sections/expiry/status).
const termsPayload = z.object({
  title: z.string().nullable(),
  body: z.string(),
  project_name: z.string().nullable(),
  client_name: z.string().nullable(),
  client_phone: z.string().nullable(),
  company_name: z.string().nullable(),
  logo_url: z.string().nullable(),
  company_phone: z.string().nullable(),
  company_email: z.string().nullable(),
  company_address: z.string().nullable(),
  payment_summary: z.string().nullable(),
  sections: z.array(z.record(z.string(), z.unknown())).default([]),
  expires_at: z.string().nullable(),
  revoked: z.boolean().default(false),
  acknowledged_at: z.string().nullable(),
  acknowledged_by_name: z.string().nullable(),
  access_count: z.number().default(0),
  // Letterhead + bill-to, so the sheet reads as the legal document it is.
  company_legal_name: z.string().nullable().nullish(),
  company_website: z.string().nullable().nullish(),
  document_footer_note: z.string().nullable().nullish(),
  client_email: z.string().nullable().nullish(),
  client_address: z.string().nullable().nullish(),
  gstin: z.string().nullable().nullish(),
  document_number: z.string().nullable().nullish(),
  issued_at: z.string().nullable().nullish(),
})
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

  // 5-state lifecycle + KPIs are derived client-side from the same rows;
  // revoke/rotate act on the underlying document + access token.
  .post('/documents/:id/revoke', requireAction('projects', 'edit'), async (c) => {
    const id = c.req.param('id')
    if (!id || !z.string().uuid().safeParse(id).success) fail(422, 'Invalid document id.')
    const ok = await attempt(c, 'terms.revoke', () =>
      withUser(c.env, c.get('auth').userId, async (sql) => {
        const rows = await sql`update project_terms_documents set revoked_at = now() where id = ${id as string} returning id`
        return (rows as unknown[]).length > 0
      }),
    )
    if (!ok) fail(400, 'We could not revoke this document.')
    await audit(c, { action: 'terms.revoke', entityType: 'terms_document', entityId: id })
    return c.json({ ok: true })
  })

  .post('/documents/:id/rotate', requireAction('projects', 'edit'), async (c) => {
    const id = c.req.param('id')
    if (!id || !z.string().uuid().safeParse(id).success) fail(422, 'Invalid document id.')
    const row = await attempt(c, 'terms.rotate', () =>
      withUser(c.env, c.get('auth').userId, async (sql) => {
        const docs = await sql<{ project_id: string | null; rendered_body: string }[]>`
          select project_id, rendered_body from project_terms_documents where id = ${id as string} limit 1`
        const doc = docs[0]
        if (!doc) return null
        await sql`update project_terms_documents set revoked_at = now() where id = ${id as string}`
        const made = await sql<{ document_id: string; token: string }[]>`
          select * from issue_terms_document(p_project_id => ${doc.project_id}, p_rendered_body => ${doc.rendered_body})`
        return made[0] ?? null
      }),
    )
    if (!row) fail(400, 'We could not rotate this link.')
    await audit(c, { action: 'terms.rotate', entityType: 'terms_document', entityId: id, after: { document_id: row.document_id } })
    return c.json(issueTermsResponse.parse(row), 201)
  })

  .post('/email-log', requireAction('projects', 'edit'), async (c) => {
    const parsed = z.object({
      document_id: z.string().uuid().nullable().optional(),
      to: z.string().max(200),
      subject: z.string().max(200),
      body: z.string().max(10000),
      status: z.enum(['draft', 'sent', 'failed']).default('sent'),
    }).safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success) fail(422, 'Please check the email details.')
    const auth = c.get('auth')
    const row = await attempt(c, 'terms.email_log', () =>
      withUser(c.env, auth.userId, async (sql) => {
        const rows = await sql<{ id: string }[]>`
          insert into terms_email_logs ${sql({ company_id: auth.companyId, document_id: parsed.data.document_id ?? null, to_email: parsed.data.to, subject: parsed.data.subject, body: parsed.data.body, status: parsed.data.status })} returning id`
        return rows[0] ?? null
      }),
    )
    if (!row) fail(400, 'We could not log the email.')
    await audit(c, { action: 'terms.email_log', entityType: 'terms_document', entityId: parsed.data.document_id ?? 'none', after: { to: parsed.data.to } })
    return c.json({ id: row.id }, 201)
  })

  .get('/email-log', requireAction('projects', 'view'), async (c) => {
    const rows = await attempt(c, 'terms.email_log.list', () =>
      withUser(c.env, c.get('auth').userId, (sql) => sql`
        select id, document_id, to_email as "to", subject, body, status, sent_at from terms_email_logs order by sent_at desc limit 200`),
    )
    if (!rows) fail(400, 'We could not load email history.')
    return c.json(rows)
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
    // Lovable parity extras (best-effort).
    try {
      await withUser(c.env, c.get('auth').userId, async (sql) => {
        await sql`update project_terms_documents set
            title = coalesce(${parsed.data.title ?? null}, title),
            payment_summary = coalesce(${parsed.data.payment_summary ?? null}, payment_summary),
            sections = coalesce(${parsed.data.sections ? sql.json(parsed.data.sections as never) : null}::jsonb, sections),
            expires_at = coalesce((${parsed.data.expiry_days != null ? sql`now() + make_interval(days => ${parsed.data.expiry_days})` : sql`null`})::timestamptz, expires_at)
          where id = ${row.document_id}`
      })
    } catch { /* extras never fail issuance */ }
    await audit(c, {
      action: 'terms.issue',
      entityType: 'terms_document',
      entityId: row.document_id,
      after: { project_id: parsed.data.project_id },
    })
    return c.json(issueTermsResponse.parse(row), 201)
  })

  // Lovable parity: revoke + resend-email (logged to project_terms_email_logs).
  .post('/documents/:id/revoke', requireAction('projects', 'edit'), async (c) => {
    const id = textParam(c, 'id', 400)
    const ok = await attempt(c, 'terms.revoke', () =>
      withUser(c.env, c.get('auth').userId, async (sql) => {
        await sql`update project_terms_documents set revoked_at = now()
          where id = ${id}::uuid and company_id = ${c.get('auth').companyId}`
        return true
      }),
    )
    if (!ok) fail(400, 'We could not revoke this link.')
    await audit(c, { action: 'terms.revoke', entityType: 'terms_document', entityId: id })
    return c.json({ ok: true })
  })

  .get('/documents/:id/email-logs', requireAction('projects', 'view'), async (c) => {
    const id = textParam(c, 'id', 400)
    const rows = await attempt(c, 'terms.email_logs', () =>
      withUser(c.env, c.get('auth').userId, (sql) => sql`
        select id, to_email, status, error, created_at from project_terms_email_logs
        where document_id = ${id}::uuid order by created_at desc limit 50`),
    )
    if (!rows) fail(400, 'We could not load email logs.')
    return c.json(rows)
  })

/** PUBLIC (no auth): client views + acknowledges terms by token. */
export const publicTermsRouter = new Hono<AppEnv>()
  // Lovable parity: rich payload first; body-only kept for old clients.
  .get('/terms/:token/payload', async (c) => {
    const token = textParam(c, 'token', 400)
    const rows = await attempt(c, 'terms.public_payload', () =>
      withService(c.env, (sql) => sql`select * from get_terms_payload_for_token(p_raw => ${token})`),
    )
    if (!rows) fail(503, 'The service is temporarily unavailable. Please try again in a moment.')
    if (!rows[0]) fail(404, 'This link is invalid or has expired.')
    return c.json(termsPayload.parse({ ...rows[0] as Record<string, unknown>, body: (rows[0] as { body?: string }).body ?? '' }))
  })

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
