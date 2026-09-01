import { z } from 'zod'
import { uuid, isoDateTime, money } from './shared/primitives'

export const slotStatus = z.enum(['booked', 'released', 'cancelled'])

export const teamSlot = z.object({
  id: uuid,
  user_id: uuid,
  user_name: z.string().nullable(),
  shoot_id: uuid.nullable(),
  service_name: z.string().nullable(),
  start_at: isoDateTime,
  end_at: isoDateTime,
  status: slotStatus,
  estimated_cost: money.nullable(),
})
export type TeamSlot = z.infer<typeof teamSlot>

export const bookSlotRequest = z.object({
  user_id: uuid,
  shoot_id: uuid.nullable().default(null),
  service_name: z.string().max(120).optional(),
  start_at: isoDateTime,
  end_at: isoDateTime,
  estimated_cost: money.optional(),
})
export type BookSlotRequest = z.infer<typeof bookSlotRequest>

export const setSlotStatusRequest = z.object({ status: slotStatus })

/** Lightweight team member for pickers (assignees, bookings). */
export const teamMember = z.object({
  user_id: uuid,
  name: z.string(),
  role: z.string(),
})
export type TeamMember = z.infer<typeof teamMember>

// The directory row, add-member payload and invitations live in ./team.
