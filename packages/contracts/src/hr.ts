import { z } from 'zod'
import { uuid, isoDate, isoDateTime } from './shared/primitives'

export const attendanceStatus = z.enum(['present', 'late', 'absent'])

export const attendanceRecord = z.object({
  id: uuid,
  a_date: isoDate,
  check_in_at: isoDateTime.nullable(),
  check_out_at: isoDateTime.nullable(),
  status: attendanceStatus,
})
export type AttendanceRecord = z.infer<typeof attendanceRecord>

export const checkInRequest = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
})
export type CheckInRequest = z.infer<typeof checkInRequest>

export const companyFence = z.object({
  lat: z.number(),
  lng: z.number(),
  radius_m: z.number().int(),
})
export type CompanyFence = z.infer<typeof companyFence>
