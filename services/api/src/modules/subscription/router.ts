import { Hono } from 'hono'
import {
  activateRequest,
  activateResponse,
  createOrderRequest,
  createOrderResponse,
  plan,
} from '@ipc/contracts'
import type { AppEnv } from '../../context'
import { requireAuth } from '../../middleware/auth'
import { requireOwner } from '../../middleware/permissions'
import { fail } from '../../middleware/errors'
import { withService, withUser } from '../../lib/db'
import { attempt } from '../../lib/attempt'
import { audit } from '../../lib/audit'
import { isDevLike, razorpayConfigured } from '../../lib/env'
import { createRazorpayOrder, verifyRazorpaySignature } from '../../lib/razorpay'

/**
 * Plans + checkout. The order is priced in SQL (create_payment_order); when
 * Razorpay is configured the same amount is registered with the provider and
 * activation demands the Checkout signature. Without a provider, activation is
 * allowed only on a dev-like bench — never in production.
 */
export const subscriptionRouter = new Hono<AppEnv>()
  .use('*', requireAuth)

  .get('/plans', async (c) => {
    const rows = await attempt(c, 'subscription.plans', () =>
      withUser(
        c.env,
        c.get('auth').userId,
        (sql) => sql`
          select id, key, name, price, billing_interval
          from plans where is_active = true order by price`,
      ),
    )
    if (!rows) fail(400, 'We could not load plans.')
    return c.json(plan.array().parse(rows))
  })

  .post('/order', requireOwner(), async (c) => {
    const parsed = createOrderRequest.safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success) fail(422, 'A plan is required.')
    const planId = parsed.data.plan_id

    const row = await attempt(c, 'subscription.order', () =>
      withUser(c.env, c.get('auth').userId, async (sql) => {
        const rows = await sql<{ order_id: string; amount: number }[]>`
          select * from create_payment_order(p_plan_id => ${planId})`
        return rows[0] ?? null
      }),
    )
    if (!row) fail(400, 'We could not start checkout.')

    let razorpayOrderId: string | null = null
    if (razorpayConfigured(c.env)) {
      const provider = await attempt(c, 'subscription.razorpay_order', () =>
        createRazorpayOrder(c.env, {
          amountRupees: row.amount,
          receipt: row.order_id,
          notes: { company_id: c.get('auth').companyId, plan_id: planId },
        }),
      )
      if (!provider) fail(400, 'We could not reach the payment provider. Please try again.')
      razorpayOrderId = provider.id
      // payment_orders has no client write policy (0016); the provider id is
      // set by the API alone, under the service role.
      const stored = await attempt(c, 'subscription.store_provider_order', () =>
        withService(
          c.env,
          (sql) => sql`
            update payment_orders set razorpay_order_id = ${razorpayOrderId}
            where id = ${row.order_id}`,
        ),
      )
      if (!stored) fail(400, 'We could not start checkout.')
    }

    await audit(c, {
      action: 'subscription.order_created',
      entityType: 'payment_order',
      entityId: row.order_id,
      after: { plan_id: planId, amount: row.amount, razorpay_order_id: razorpayOrderId },
    })

    return c.json(
      createOrderResponse.parse({
        order_id: row.order_id,
        amount: row.amount,
        currency: 'INR',
        razorpay_order_id: razorpayOrderId,
        key_id: razorpayConfigured(c.env) ? c.env.RAZORPAY_KEY_ID : null,
      }),
      201,
    )
  })

  .post('/activate', requireOwner(), async (c) => {
    const parsed = activateRequest.safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success) fail(422, 'Invalid activation payload.')
    const { order_id, payment_id, signature } = parsed.data

    // The signature is the proof of payment. It is optional in the contract
    // only so a dev bench without a provider can exercise the flow; anywhere a
    // provider is configured, or that is not dev-like, its absence is a refusal.
    const providerOn = razorpayConfigured(c.env)
    if (providerOn || !isDevLike(c.env)) {
      if (!signature) fail(400, 'Payment verification failed.')
      const razorpayOrderId = await attempt(c, 'subscription.lookup_order', () =>
        withUser(c.env, c.get('auth').userId, async (sql) => {
          const rows = await sql<{ razorpay_order_id: string | null }[]>`
            select razorpay_order_id from payment_orders where id = ${order_id}`
          return rows[0]?.razorpay_order_id ?? null
        }),
      )
      if (!razorpayOrderId) fail(400, 'Payment verification failed.')
      const ok = await verifyRazorpaySignature(
        `${razorpayOrderId}|${payment_id}`,
        signature,
        c.env.RAZORPAY_KEY_SECRET ?? '',
      )
      if (!ok) fail(400, 'Payment verification failed.')
    }

    const row = await attempt(c, 'subscription.activate', () =>
      withUser(c.env, c.get('auth').userId, async (sql) => {
        const rows = await sql<{ duplicate: boolean; expires_at: string }[]>`
          select * from activate_subscription(
            p_order_id => ${order_id},
            p_payment_id => ${payment_id})`
        return rows[0] ?? null
      }),
    )
    if (!row) fail(400, 'We could not activate your plan.')

    await audit(c, {
      action: row.duplicate ? 'subscription.activate_replayed' : 'subscription.activated',
      entityType: 'payment_order',
      entityId: order_id,
      after: { payment_id, expires_at: row.expires_at },
    })
    return c.json(activateResponse.parse(row))
  })
