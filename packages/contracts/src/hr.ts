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
  timezone: z.string().default('Asia/Kolkata'),
})
export type CompanyFence = z.infer<typeof companyFence>

export const setFenceRequest = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  // Under 20m and GPS drift alone locks people out; over 5km is not a fence.
  radius_m: z.number().int().min(20).max(5000).default(150),
  timezone: z.string().min(3).max(60).default('Asia/Kolkata'),
})
export type SetFenceRequest = z.infer<typeof setFenceRequest>

/**
 * One person's day, as the attendance dashboard reads it.
 *
 * `status` is what was recorded; whether someone is still checked in is
 * derived from the two timestamps rather than stored, so it cannot drift out
 * of agreement with them.
 */
export const attendanceDayRow = z.object({
  user_id: uuid,
  name: z.string(),
  email: z.string().nullable(),
  phone: z.string().nullable(),
  engagement_type: z.string().nullable(),
  status: attendanceStatus,
  check_in_at: isoDateTime.nullable(),
  check_out_at: isoDateTime.nullable(),
})
export type AttendanceDayRow = z.infer<typeof attendanceDayRow>
