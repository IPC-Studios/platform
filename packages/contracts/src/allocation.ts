import { z } from 'zod'
import { uuid, isoDateTime, money } from './shared/primitives'

export const slotStatus = z.enum(['booked', 'released', 'cancelled'])
export type SlotStatus = z.infer<typeof slotStatus>

export const slotCostStatus = z.enum(['tentative', 'final', 'not_decided'])
export type SlotCostStatus = z.infer<typeof slotCostStatus>

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
  final_cost: money.nullable(),
  cost_status: slotCostStatus,
  cost_notes: z.string().nullable(),
  data_required: z.boolean().default(false),
  data_not_required_reason: z.string().nullable().default(null),
})
export type TeamSlot = z.infer<typeof teamSlot>

/** Cost is bookkeeping the studio settles, kept separate from the booking itself. */
export const setSlotCostRequest = z.object({
  estimated_cost: money.nullish(),
  final_cost: money.nullish(),
  cost_status: slotCostStatus.nullish(),
  cost_notes: z.string().trim().max(500).nullish(),
})
export type SetSlotCostRequest = z.infer<typeof setSlotCostRequest>

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
export type SetSlotStatusRequest = z.infer<typeof setSlotStatusRequest>

/** Edit a booking's who/when/what — distinct from cost (bookkeeping) and status (release/cancel). */
export const updateSlotRequest = z
  .object({
    user_id: uuid.optional(),
    shoot_id: uuid.nullable().optional(),
    service_name: z.string().max(120).nullable().optional(),
    start_at: isoDateTime.optional(),
    end_at: isoDateTime.optional(),
  })
  .refine(
    (v) => !v.start_at || !v.end_at || new Date(v.end_at) > new Date(v.start_at),
    { message: 'End must be after start.', path: ['end_at'] },
  )
export type UpdateSlotRequest = z.infer<typeof updateSlotRequest>

/** Data-requirement flag on a booking: does this slot still owe footage/cards? */
export const setSlotDataRequest = z.object({
  data_required: z.boolean(),
  data_not_required_reason: z.string().trim().max(300).nullish(),
})
export type SetSlotDataRequest = z.infer<typeof setSlotDataRequest>

/** Lightweight team member for pickers (assignees, bookings). */
export const teamMember = z.object({
  user_id: uuid,
  name: z.string(),
  role: z.string(),
})
export type TeamMember = z.infer<typeof teamMember>

// The directory row, add-member payload and invitations live in ./team.
