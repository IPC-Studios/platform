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

export const createOrderResponse = z.object({ order_id: uuid, amount: money })
export type CreateOrderResponse = z.infer<typeof createOrderResponse>

export const activateRequest = z.object({
  order_id: uuid,
  payment_id: z.string(),
  signature: z.string().optional(),
})
export type ActivateRequest = z.infer<typeof activateRequest>

export const activateResponse = z.object({
  duplicate: z.boolean(),
  expires_at: z.string(),
})
