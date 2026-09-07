import { z } from 'zod'
import { uuid, money } from './shared/primitives'

export const plan = z.object({
  id: uuid,
  key: z.string(),
  name: z.string(),
  price: money,
  billing_interval: z.enum(['monthly', 'yearly']),
})
export type Plan = z.infer<typeof plan>

export const createOrderRequest = z.object({ plan_id: uuid })
export type CreateOrderRequest = z.infer<typeof createOrderRequest>

/**
 * What checkout needs. When Razorpay is configured the order exists at the
 * provider and `razorpay_order_id` + `key_id` open Checkout; when it is not
 * (a dev bench) both are null and the client may activate directly — the API
 * refuses that path outside dev-like environments.
 */
export const createOrderResponse = z.object({
  order_id: uuid,
  amount: money,
  currency: z.string().default('INR'),
  razorpay_order_id: z.string().nullable().default(null),
  key_id: z.string().nullable().default(null),
})
export type CreateOrderResponse = z.infer<typeof createOrderResponse>

export const activateRequest = z.object({
  order_id: uuid,
  payment_id: z.string().min(1).max(100),
  signature: z.string().min(1).max(200).optional(),
})
export type ActivateRequest = z.infer<typeof activateRequest>

export const activateResponse = z.object({
  duplicate: z.boolean(),
  expires_at: z.string(),
})
export type ActivateResponse = z.infer<typeof activateResponse>
