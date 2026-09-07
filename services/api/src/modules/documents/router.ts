import { Hono } from 'hono'
import {
  issueQuotationRequest,
  issueReceiptRequest,
  issuedLink,
  publicDelivery,
  publicQuotation,
  publicReceipt,
  respondToQuotationRequest,
  z,
} from '@ipc/contracts'
import type { AppEnv } from '../../context'
import { requireAuth } from '../../middleware/auth'
import { requireAction } from '../../middleware/permissions'
import { fail } from '../../middleware/errors'
import { textParam } from '../../lib/params'
import { withService, withUser } from '../../lib/db'
import { attempt } from '../../lib/attempt'
import { audit } from '../../lib/audit'
import { resolveClientIp } from '../../lib/client-ip'

const okResponse = z.object({ ok: z.boolean() })

/**
 * Issuing the client-facing documents.
 *
 * Each one is a row plus a token; the studio gets back a link to send however
 * they like. Nothing is emailed from here — a studio sends a quotation on
 * WhatsApp as often as by mail, and the link works either way.
 */
export const documentsRouter = new Hono<AppEnv>()
  .use('*', requireAuth)

  .post('/quotations', requireAction('projects', 'edit'), async (c) => {
    const parsed = issueQuotationRequest.safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success) fail(422, 'Please pick a project to quote.')
    const row = await attempt(c, 'documents.quotation', () =>
      withUser(c.env, c.get('auth').userId, async (sql) => {
        const rows = await sql<{ quotation_id: string; token: string }[]>`
          select quotation_id, token from issue_project_quotation(
            p_project_id => ${parsed.data.project_id},
            p_notes => ${parsed.data.notes ?? null}
          )`
        return rows[0] ?? null
      }),
    )
    if (!row) fail(400, 'We could not create the quotation.')
    await audit(c, {
      action: 'quotation.issue',
      entityType: 'project_quotation',
      entityId: row.quotation_id,
      after: { project_id: parsed.data.project_id },
    })
    return c.json(issuedLink.parse({ link: `${c.env.APP_URL}/quotation?token=${row.token}` }), 201)
  })

  .post('/receipts', requireAction('billing', 'view'), async (c) => {
    const parsed = issueReceiptRequest.safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success) fail(422, 'Please pick a payment.')
    const rows = await attempt(c, 'documents.receipt', () =>
      withUser(
        c.env,
        c.get('auth').userId,
        (sql) => sql<{ token: string }[]>`
          select issue_payment_receipt(p_payment_id => ${parsed.data.payment_id}) as token`,
      ),
    )
    const token = rows?.[0]?.token
    if (!token) fail(400, 'We could not create the receipt.')
    return c.json(issuedLink.parse({ link: `${c.env.APP_URL}/receipt?token=${token}` }), 201)
  })

/**
 * PUBLIC (no auth): what the client opens.
 *
 * service_role because the reader has no session; every query is scoped by the
 * token, which resolves to exactly one row.
 */
export const publicDocumentsRouter = new Hono<AppEnv>()
  .get('/quotation/:token', async (c) => {
    const token = textParam(c, 'token', 400)
    const rows = await attempt(c, 'documents.public_quotation', () =>
      withService(c.env, (sql) => sql`select * from get_quotation_for_token(p_raw => ${token})`),
    )
    if (!rows) fail(503, 'The service is temporarily unavailable. Please try again in a moment.')
    if (!rows[0]) fail(404, 'This link is invalid or has expired.')
    return c.json(publicQuotation.parse(rows[0]))
  })

  .post('/quotation/:token/respond', async (c) => {
    const parsed = respondToQuotationRequest.safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success) fail(422, 'Please say yes or no.')
    // A name is the signature on an acceptance; declining asks for nothing.
    if (parsed.data.accept && (parsed.data.name ?? '').trim().length < 2) {
      fail(422, 'Please type your name to accept.')
    }
    const token = textParam(c, 'token', 400)
    const ip = resolveClientIp(c.req.raw.headers, c.env.CLIENT_IP_HEADER)
    const rows = await attempt(c, 'documents.quotation_respond', () =>
      withService(
        c.env,
        (sql) => sql<{ ok: boolean }[]>`
          select respond_to_quotation(
            p_raw => ${token},
            p_accept => ${parsed.data.accept},
            p_name => ${parsed.data.name ?? null},
            p_ip => ${ip === 'unknown' ? null : ip},
            p_user_agent => ${c.req.header('User-Agent') ?? null}
          ) as ok`,
      ),
    )
    if (!rows) fail(400, 'We could not record your answer.')
    if (rows[0]?.ok === false) fail(409, 'This quotation has already been answered, or the link has expired.')
    return c.json(okResponse.parse({ ok: true }))
  })

  .get('/receipt/:token', async (c) => {
    const token = textParam(c, 'token', 400)
    const rows = await attempt(c, 'documents.public_receipt', () =>
      withService(c.env, (sql) => sql`select * from get_receipt_for_token(p_raw => ${token})`),
    )
    if (!rows) fail(503, 'The service is temporarily unavailable. Please try again in a moment.')
    if (!rows[0]) fail(404, 'This link is invalid or has expired.')
    return c.json(publicReceipt.parse(rows[0]))
  })

  .get('/delivery/:token', async (c) => {
    const token = textParam(c, 'token', 400)
    const rows = await attempt(c, 'documents.public_delivery', () =>
      withService(c.env, (sql) => sql`select * from get_delivery_for_token(p_raw => ${token})`),
    )
    if (!rows) fail(503, 'The service is temporarily unavailable. Please try again in a moment.')
    if (!rows[0]) fail(404, 'This link is invalid, expired, or the work is not ready yet.')
    return c.json(publicDelivery.parse(rows[0]))
  })
