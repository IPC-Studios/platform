import { Hono } from 'hono'
import {
  activateRequest,
  activateResponse,
  createOrderResponse,
  plan,
} from '@ipc/contracts'
import type { AppEnv } from '../../context'
import { requireAuth } from '../../middleware/auth'
import { requireOwner } from '../../middleware/permissions'
import { fail } from '../../middleware/errors'
import { requestClient } from '../../lib/supabase'
import { verifyRazorpaySignature } from '../../lib/razorpay'

export const subscriptionRouter = new Hono<AppEnv>()
  .use('*', requireAuth)

  .get('/plans', async (c) => {
    const { data, error } = await requestClient(c)
      .from('plans')
      .select('id,key,name,price,billing_interval')
      .eq('is_active', true)
      .order('price')
    if (error) fail(400, 'We could not load plans.')
    return c.json(plan.array().parse(data ?? []))
  })

  .post('/order', requireOwner(), async (c) => {
    const body = await c.req.json().catch(() => ({}))
    const planId = typeof body?.plan_id === 'string' ? body.plan_id : ''
    if (!planId) fail(422, 'A plan is required.')
    const { data, error } = await requestClient(c).rpc('create_payment_order', { p_plan_id: planId }).single()
    if (error || !data) fail(400, 'We could not start checkout.')
    const row = data as { order_id: string; amount: number }
    return c.json(createOrderResponse.parse(row), 201)
  })

  .post('/activate', requireOwner(), async (c) => {
    const parsed = activateRequest.safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success) fail(422, 'Invalid activation payload.')

    // Verify the Razorpay signature when one is provided (real checkout).
    if (parsed.data.signature) {
      const ok = await verifyRazorpaySignature(
        `${parsed.data.order_id}|${parsed.data.payment_id}`,
        parsed.data.signature,
        c.env.RAZORPAY_KEY_SECRET ?? '',
      )
      if (!ok) fail(400, 'Payment verification failed.')
    }

    const { data, error } = await requestClient(c)
      .rpc('activate_subscription', {
        p_order_id: parsed.data.order_id,
        p_payment_id: parsed.data.payment_id,
      })
      .single()
    if (error || !data) fail(400, 'We could not activate your plan.')
    const row = data as { duplicate: boolean; expires_at: string }
    return c.json(activateResponse.parse(row))
  })
