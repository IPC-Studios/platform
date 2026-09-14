import { z } from 'zod'
import { uuid, isoDateTime } from './shared/primitives'

export const custodyStatus = z.enum(['pending', 'copied', 'verified'])
export type CustodyStatus = z.infer<typeof custodyStatus>

export const storageLocationKind = z.enum(['drive', 'nas', 'cloud', 'other'])
export type StorageLocationKind = z.infer<typeof storageLocationKind>

export const storageLocation = z.object({
  id: uuid,
  name: z.string(),
  kind: storageLocationKind,
})
export type StorageLocation = z.infer<typeof storageLocation>

export const createStorageLocationRequest = z.object({
  name: z.string().trim().min(1).max(120),
  kind: storageLocationKind.default('drive'),
})
export type CreateStorageLocationRequest = z.infer<typeof createStorageLocationRequest>

export const updateStorageLocationRequest = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  kind: storageLocationKind.optional(),
})
export type UpdateStorageLocationRequest = z.infer<typeof updateStorageLocationRequest>

export const dataRecord = z.object({
  id: uuid,
  data_label: z.string(),
  data_type: z.string().nullable(),
  project_id: uuid.nullable(),
  project_name: z.string().nullable(),
  shoot_id: uuid.nullable(),
  primary_status: custodyStatus,
  backup_status: custodyStatus,
  primary_location_id: uuid.nullable(),
  primary_location_name: z.string().nullable(),
  backup_location_id: uuid.nullable(),
  backup_location_name: z.string().nullable(),
  card_count: z.number().int(),
  size_gb: z.number(),
  verified_at: isoDateTime.nullable(),
  created_at: isoDateTime,
})
export type DataRecord = z.infer<typeof dataRecord>

export const createDataRecordRequest = z.object({
  shoot_id: uuid.nullable().default(null),
  project_id: uuid.nullable().default(null),
  data_label: z.string().trim().min(1).max(160),
  data_type: z.string().max(80).optional(),
  card_count: z.number().int().min(0).default(0),
  size_gb: z.number().min(0).default(0),
  primary_location_id: uuid.nullable().optional(),
  backup_location_id: uuid.nullable().optional(),
})
export type CreateDataRecordRequest = z.infer<typeof createDataRecordRequest>

export const updateDataRecordRequest = z.object({
  shoot_id: uuid.nullable().optional(),
  project_id: uuid.nullable().optional(),
  data_label: z.string().trim().min(1).max(160).optional(),
  data_type: z.string().max(80).nullable().optional(),
  card_count: z.number().int().min(0).optional(),
  size_gb: z.number().min(0).optional(),
  primary_location_id: uuid.nullable().optional(),
  backup_location_id: uuid.nullable().optional(),
})
export type UpdateDataRecordRequest = z.infer<typeof updateDataRecordRequest>

export const verifyDataRequest = z.object({ track: z.enum(['primary', 'backup']) })
