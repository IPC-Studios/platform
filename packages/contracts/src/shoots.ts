import { z } from 'zod'
import { uuid, isoDate, isoDateTime } from './shared/primitives'

export const shootStatus = z.enum(['planned', 'confirmed', 'completed', 'cancelled'])
export type ShootStatus = z.infer<typeof shootStatus>

/**
 * One line of "who and what this day needs" — a service by name and how many
 * of it. Named rather than referenced by id: the picker lets a studio type
 * "Drone pilot" for the first time, and the server upserts the service behind
 * it, so nobody has to visit a settings page before booking a shoot.
 */
export const shootRequirementInput = z.object({
  name: z.string().trim().min(1).max(80),
  quantity: z.number().int().min(1).max(99).default(1),
})
export type ShootRequirementInput = z.infer<typeof shootRequirementInput>

export const shootRequirement = z.object({
  service_id: uuid,
  name: z.string(),
  quantity: z.number().int(),
})
export type ShootRequirement = z.infer<typeof shootRequirement>

export const shootListItem = z.object({
  id: uuid,
  name: z.string(),
  project_id: uuid,
  project_name: z.string().nullable(),
  client_name: z.string().nullable(),
  shoot_date: isoDate.nullable(),
  location: z.string().nullable(),
  status: shootStatus,
  /** What the day was planned to need — the booking screen fills against it. */
  requirements: z.array(shootRequirement),
})
export type ShootListItem = z.infer<typeof shootListItem>

/** A service this company has used before, offered as you type. */
export const serviceOption = z.object({ id: uuid, name: z.string() })
export type ServiceOption = z.infer<typeof serviceOption>

/**
 * A map link is a link. Storing an address here instead would put the driver's
 * pin and the printed address in the same field, and lose one of them.
 */
const mapLink = z.string().trim().url().max(500)

export const createShootRequest = z.object({
  project_id: uuid,
  name: z.string().trim().min(1).max(160),
  shoot_date: isoDate.optional(),
  start_at: isoDateTime.optional(),
  end_at: isoDateTime.optional(),
  location: z.string().trim().max(200).optional(),
  map_link: mapLink.optional(),
  status: shootStatus.default('planned'),
  // Optional rather than defaulted: a caller with no crew to record should not
  // have to send an empty array to say so.
  requirements: z.array(shootRequirementInput).max(40).optional(),
})
export type CreateShootRequest = z.infer<typeof createShootRequest>

export const updateShootRequest = z.object({
  name: z.string().trim().min(1).max(160).optional(),
  shoot_date: isoDate.optional(),
  start_at: isoDateTime.optional(),
  location: z.string().trim().max(200).optional(),
  map_link: mapLink.optional(),
  status: shootStatus.optional(),
})
export type UpdateShootRequest = z.infer<typeof updateShootRequest>

/**
 * A saved shape a studio repeats. 'shoot' is a whole day — its requirements
 * and its internal work; 'internal_work' is just the edit-room list. The
 * payload is the shape itself — the requirements and the internal-work titles
 * that get stamped onto a shoot when the preset is applied.
 */
export const shootPresetKind = z.enum(['shoot', 'internal_work'])
export type ShootPresetKind = z.infer<typeof shootPresetKind>

export const shootPresetPayload = z.object({
  requirements: z.array(shootRequirementInput).max(40).default([]),
  internal_work: z.array(z.string().trim().min(1).max(200)).max(40).default([]),
})
export type ShootPresetPayload = z.infer<typeof shootPresetPayload>

export const shootPreset = z.object({
  id: uuid,
  kind: shootPresetKind,
  name: z.string(),
  payload: shootPresetPayload,
})
export type ShootPreset = z.infer<typeof shootPreset>

export const saveShootPresetRequest = z.object({
  kind: shootPresetKind,
  name: z.string().trim().min(1).max(80),
  payload: shootPresetPayload,
})
export type SaveShootPresetRequest = z.infer<typeof saveShootPresetRequest>
