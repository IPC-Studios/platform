import { z } from 'zod'
import { uuid, isoDate, isoDateTime } from './shared/primitives'

export const shootStatus = z.enum(['planned', 'confirmed', 'completed', 'cancelled'])
export type ShootStatus = z.infer<typeof shootStatus>

export const shootListItem = z.object({
  id: uuid,
  name: z.string(),
  project_id: uuid,
  project_name: z.string().nullable(),
  shoot_date: isoDate.nullable(),
  location: z.string().nullable(),
  status: shootStatus,
})
export type ShootListItem = z.infer<typeof shootListItem>

export const createShootRequest = z.object({
  project_id: uuid,
  name: z.string().trim().min(1).max(160),
  shoot_date: isoDate.optional(),
  start_at: isoDateTime.optional(),
  end_at: isoDateTime.optional(),
  location: z.string().trim().max(200).optional(),
  status: shootStatus.default('planned'),
})
export type CreateShootRequest = z.infer<typeof createShootRequest>

export const updateShootRequest = z.object({
  name: z.string().trim().min(1).max(160).optional(),
  shoot_date: isoDate.optional(),
  location: z.string().trim().max(200).optional(),
  status: shootStatus.optional(),
})
export type UpdateShootRequest = z.infer<typeof updateShootRequest>
