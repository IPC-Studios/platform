import { z } from 'zod'
import { uuid, isoDateTime, email as emailSchema } from './shared/primitives'

export const client = z.object({
  id: uuid,
  company_id: uuid,
  name: z.string(),
  email: z.string().nullable(),
  phone: z.string().nullable(),
  alternate_phone: z.string().nullable(),
  address: z.string().nullable(),
  city: z.string().nullable(),
  notes: z.string().nullable(),
  created_at: isoDateTime,
})
export type Client = z.infer<typeof client>

export const createClientRequest = z.object({
  name: z.string().trim().min(1).max(160),
  email: emailSchema.optional(),
  phone: z.string().trim().max(20).optional(),
  alternate_phone: z.string().trim().max(20).optional(),
  address: z.string().trim().max(400).optional(),
  city: z.string().trim().max(120).optional(),
  notes: z.string().trim().max(2000).optional(),
})
export type CreateClientRequest = z.infer<typeof createClientRequest>

export const updateClientRequest = createClientRequest.partial()
export type UpdateClientRequest = z.infer<typeof updateClientRequest>
