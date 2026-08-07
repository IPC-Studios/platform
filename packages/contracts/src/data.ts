import { z } from 'zod'
import { uuid, isoDateTime } from './shared/primitives'

export const custodyStatus = z.enum(['pending', 'copied', 'verified'])

export const dataRecord = z.object({
  id: uuid,
  data_label: z.string(),
  data_type: z.string().nullable(),
  primary_status: custodyStatus,
  backup_status: custodyStatus,
  card_count: z.number().int(),
  size_gb: z.number(),
  verified_at: isoDateTime.nullable(),
})
export type DataRecord = z.infer<typeof dataRecord>

export const createDataRecordRequest = z.object({
  shoot_id: uuid.nullable().default(null),
  project_id: uuid.nullable().default(null),
  data_label: z.string().trim().min(1).max(160),
  data_type: z.string().max(80).optional(),
  card_count: z.number().int().min(0).default(0),
  size_gb: z.number().min(0).default(0),
})
export type CreateDataRecordRequest = z.infer<typeof createDataRecordRequest>

export const verifyDataRequest = z.object({ track: z.enum(['primary', 'backup']) })
