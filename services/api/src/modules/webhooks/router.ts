import { Hono } from 'hono'
import { captureLeadRequest } from '@ipc/contracts'
import type { AppEnv } from '../../context'
import { fail } from '../../middleware/errors'
import { withService } from '../../lib/db'
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
    const id = await withService(c.env, async (sql) => {
      const rows = await sql`
        select capture_lead(
          p_source_key => ${c.req.param('sourceKey')},
          p_name => ${parsed.data.name ?? null},
          p_phone => ${parsed.data.phone},
          p_email => ${parsed.data.email ?? null},
          p_meta => ${sql.json((parsed.data.meta ?? {}) as Parameters<typeof sql.json>[0])}
        ) as id`
      return rows[0]?.id as string | undefined
    }).catch(() => null)
    if (!id) fail(400, 'We could not capture this lead.')
    return c.json({ id: id as string }, 201)
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

    const fresh = await withService(c.env, async (sql) => {
      const rows = await sql`
        select record_webhook_event(p_event_id => ${eventId}, p_payload => ${sql.json(body)}) as fresh`
      return rows[0]?.fresh as boolean | undefined
    }).catch(() => undefined)
    if (fresh === false) return c.json({ ok: true, duplicate: true }) // already processed

    const pay = body.payload?.payment?.entity
    if (pay?.order_id && pay.id) {
      // Best-effort activation; RPC is idempotent regardless.
      const orderId = pay.order_id
      const paymentId = pay.id
      await withService(c.env, async (sql) => {
        await sql`
          select * from activate_subscription(
            p_order_id => ${orderId},
            p_payment_id => ${paymentId}
          )`
      }).catch(() => undefined)
    }
    return c.json({ ok: true })
  })
