import { Hono } from 'hono'
import { captureLeadRequest } from '@ipc/contracts'
import type { AppEnv } from '../../context'
import { fail } from '../../middleware/errors'
import { serviceClient } from '../../lib/supabase'
import { verifyRazorpaySignature } from '../../lib/razorpay'

/**
 * PUBLIC webhook ingress — no auth. The source key resolves the tenant inside
 * the capture_lead RPC; the service client is used only to invoke that RPC,
 * which itself dedupes and auto-assigns. Meta and generic web forms share it.
 */
export const webhooksRouter = new Hono<AppEnv>()
  .post('/lead/:sourceKey', async (c) => {
    const parsed = captureLeadRequest.safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success) fail(422, 'Invalid lead payload.')
    const { data, error } = await serviceClient(c.env).rpc('capture_lead', {
      p_source_key: c.req.param('sourceKey'),
      p_name: parsed.data.name ?? null,
      p_phone: parsed.data.phone,
      p_email: parsed.data.email ?? null,
      p_meta: parsed.data.meta ?? {},
    })
    if (error || !data) fail(400, 'We could not capture this lead.')
    return c.json({ id: data as string }, 201)
  })

  // Meta subscription verification handshake (GET with hub.challenge).
  .get('/meta', (c) => {
    const challenge = c.req.query('hub.challenge')
    if (challenge) return c.text(challenge)
    return c.json({ ok: true })
  })

  // Razorpay webhook: verify HMAC over the raw body, record idempotently, and
  // activate on a captured payment. A replayed event is a no-op.
  .post('/razorpay', async (c) => {
    const raw = await c.req.text()
    const signature = c.req.header('x-razorpay-signature') ?? ''
    const ok = await verifyRazorpaySignature(raw, signature, c.env.RAZORPAY_WEBHOOK_SECRET ?? '')
    if (!ok) fail(401, 'Invalid signature.')

    const body = JSON.parse(raw) as {
      id?: string
      payload?: { payment?: { entity?: { order_id?: string; id?: string } } }
    }
    const eventId = body.id ?? ''
    if (!eventId) fail(422, 'Missing event id.')

    const svc = serviceClient(c.env)
    const { data: fresh } = await svc.rpc('record_webhook_event', { p_event_id: eventId, p_payload: body })
    if (fresh === false) return c.json({ ok: true, duplicate: true }) // already processed

    const pay = body.payload?.payment?.entity
    if (pay?.order_id && pay.id) {
      // Best-effort activation; RPC is idempotent regardless.
      await svc.rpc('activate_subscription', { p_order_id: pay.order_id, p_payment_id: pay.id })
    }
    return c.json({ ok: true })
  })
