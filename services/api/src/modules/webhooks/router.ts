import { Hono } from 'hono'
import { captureLeadRequest } from '@ipc/contracts'
import type { AppEnv } from '../../context'
import { fail } from '../../middleware/errors'
import { textParam } from '../../lib/params'
import { withService } from '../../lib/db'
import { attempt } from '../../lib/attempt'
import { timingSafeEqual } from '../../lib/crypto'
import { log } from '../../lib/log'
import { fetchMetaLead, isMetaLeadgenPayload, metaLeadgenIds, verifyMetaSignature } from '../../lib/meta'
import { verifyRazorpaySignature } from '../../lib/razorpay'

/**
 * PUBLIC webhook ingress — no auth. The source key resolves the tenant inside
 * the capture_lead RPC; the service client is used only to invoke that RPC,
 * which itself dedupes and auto-assigns. Meta and generic web forms share it.
 *
 * Two body shapes arrive here:
 *   - a plain JSON lead ({name, phone, email, meta}) from a web form
 *   - Meta's leadgen notification ({object:'page', entry:[…leadgen_id…]}),
 *     signed with the app secret; the lead itself is fetched from the Graph API
 */
export const webhooksRouter = new Hono<AppEnv>()
  .post('/lead/:sourceKey', async (c) => {
    const sourceKey = textParam(c, 'sourceKey')
    const raw = await c.req.text()
    const signature = c.req.header('X-Hub-Signature-256') ?? ''

    // A signature, when present, must be right. When the app secret is set,
    // a Meta-shaped post without one is a forgery.
    if (signature) {
      const ok = await verifyMetaSignature(raw, signature, c.env.META_APP_SECRET ?? '')
      if (!ok) fail(401, 'Invalid signature.')
    }

    let body: unknown = {}
    try {
      body = raw ? JSON.parse(raw) : {}
    } catch {
      fail(422, 'Invalid lead payload.')
    }

    const capture = (lead: {
      name?: string | null | undefined
      phone: string
      email?: string | null | undefined
      meta?: Record<string, unknown> | undefined
    }) =>
      attempt(
        c,
        'webhooks.capture_lead',
        () =>
          withService(c.env, async (sql) => {
            const rows = await sql<{ id: string }[]>`
              select capture_lead(
                p_source_key => ${sourceKey},
                p_name => ${lead.name ?? null},
                p_phone => ${lead.phone},
                p_email => ${lead.email ?? null},
                p_meta => ${sql.json((lead.meta ?? {}) as Parameters<typeof sql.json>[0])}
              ) as id`
            return rows[0]?.id ?? null
          }),
        // An unknown or paused key is the one refusal a caller should see as
        // such, not as a generic failure.
        { onCode: (code) => (code === '42501' ? ('unknown_source' as const) : undefined) },
      )

    if (isMetaLeadgenPayload(body)) {
      if (c.env.META_APP_SECRET && !signature) fail(401, 'Missing signature.')
      if (!c.env.META_PAGE_ACCESS_TOKEN) {
        log.warn({ requestId: c.get('requestId'), sourceKey }, 'meta leadgen received but META_PAGE_ACCESS_TOKEN is unset')
        // Meta retries on non-2xx; there is nothing to retry into. Acknowledge.
        return c.json({ ok: true, captured: 0, skipped: 'not_configured' })
      }
      const ids: string[] = []
      for (const item of metaLeadgenIds(body)) {
        const fetched = await attempt(c, 'webhooks.meta_fetch', () => fetchMetaLead(c.env, item.leadgen_id))
        if (!fetched || !fetched.phone) continue
        const id = await capture({
          name: fetched.name,
          phone: fetched.phone,
          email: fetched.email,
          meta: { ...item.meta, fields: fetched.fields },
        })
        if (id === 'unknown_source') fail(404, 'This lead source is not active.')
        if (id) ids.push(id)
      }
      return c.json({ ok: true, captured: ids.length, ids })
    }

    const parsed = captureLeadRequest.safeParse(body)
    if (!parsed.success) fail(422, 'Invalid lead payload.')
    const id = await capture(parsed.data)
    if (id === 'unknown_source') fail(404, 'This lead source is not active.')
    if (!id) fail(400, 'We could not capture this lead.')
    return c.json({ id }, 201)
  })

  // Meta subscription verification handshake (GET with hub.challenge). Meta
  // sends the verify token the studio configured; without checking it anyone
  // could complete the handshake and point a subscription here.
  .get('/meta', (c) => {
    const mode = c.req.query('hub.mode')
    const token = c.req.query('hub.verify_token') ?? ''
    const challenge = c.req.query('hub.challenge')
    const expected = c.env.META_VERIFY_TOKEN ?? ''
    if (mode !== 'subscribe' || !challenge) return c.json({ ok: true })
    if (!expected || !timingSafeEqual(token, expected)) fail(403, 'Verification token mismatch.')
    return c.text(challenge)
  })

  // Razorpay webhook: verify HMAC over the raw body, record idempotently, and
  // activate on a captured payment. A replayed event is a no-op.
  .post('/razorpay', async (c) => {
    const raw = await c.req.text()
    const signature = c.req.header('x-razorpay-signature') ?? ''
    const ok = await verifyRazorpaySignature(raw, signature, c.env.RAZORPAY_WEBHOOK_SECRET ?? '')
    if (!ok) fail(401, 'Invalid signature.')

    let body: {
      id?: string
      event?: string
      payload?: { payment?: { entity?: { order_id?: string; id?: string } } }
    }
    try {
      body = JSON.parse(raw) as typeof body
    } catch {
      fail(422, 'Malformed event body.')
    }
    const eventId = body!.id ?? ''
    if (!eventId) fail(422, 'Missing event id.')

    const fresh = await attempt(c, 'webhooks.razorpay.record', () =>
      withService(c.env, async (sql) => {
        const rows = await sql<{ fresh: boolean }[]>`
          select record_webhook_event(p_event_id => ${eventId}, p_payload => ${sql.json(body as never)}) as fresh`
        return rows[0]?.fresh ?? false
      }),
    )
    // A failed ledger write must NOT proceed to activation: the provider will
    // retry, and replay safety depends on the ledger having the row first.
    if (fresh === null) fail(503, 'The service is temporarily unavailable. Please try again in a moment.')
    if (fresh === false) return c.json({ ok: true, duplicate: true })

    const pay = body!.payload?.payment?.entity
    if (pay?.order_id && pay.id) {
      const orderId = pay.order_id
      const paymentId = pay.id
      const activated = await attempt(c, 'webhooks.razorpay.activate', () =>
        withService(c.env, async (sql) => {
          const [order] = await sql<{ id: string }[]>`
            select id from payment_orders where razorpay_order_id = ${orderId}`
          if (!order) return 'no_order' as const
          await sql`
            select * from activate_subscription(
              p_order_id => ${order.id},
              p_payment_id => ${paymentId}
            )`
          return 'ok' as const
        }),
      )
      if (activated === 'no_order') {
        log.warn({ requestId: c.get('requestId'), orderId, eventId }, 'razorpay event for unknown order')
      }
    }
    return c.json({ ok: true })
  })
