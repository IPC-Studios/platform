import { z } from 'zod'
import { uuid, isoDate, isoDateTime } from './shared/primitives'

export const attendanceStatus = z.enum(['present', 'late', 'absent'])

export const attendanceRecord = z.object({
  id: uuid,
  a_date: isoDate,
  check_in_at: isoDateTime.nullable(),
  check_out_at: isoDateTime.nullable(),
  status: attendanceStatus,
  /** Minutes past the studio's expected start. 0 unless the status is 'late'. */
  late_minutes: z.number().int().default(0),
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
  /** When off, check-in still works but location is not validated — for a shoot day away from the studio, or while re-measuring. */
  is_active: z.boolean().default(true),
  /**
   * HH:MM, or null when the studio has not declared a start of day.
   *
   * Null is the important value: nobody can be late for a day that has no
   * declared start, so lateness stays off until an owner sets this.
   */
  expected_checkin_time: z.string().nullable().default(null),
  /** Minutes after the start that are still forgiven. */
  late_grace_minutes: z.number().int().default(15),
  /** HH:MM, or null — after this, a day with no check-in reads as missed. */
  missed_cutoff_time: z.string().nullable().default(null),
})
export type CompanyFence = z.infer<typeof companyFence>

export const setFenceRequest = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  // Under 20m and GPS drift alone locks people out; over 5km is not a fence.
  radius_m: z.number().int().min(20).max(5000).default(150),
  timezone: z.string().min(3).max(60).default('Asia/Kolkata'),
  is_active: z.boolean().default(true),
  // HH:MM or HH:MM:SS — an <input type="time"> sends the first, Postgres
  // returns the second. An empty input means "no start of day declared", so
  // '' is coerced to null rather than rejected.
  expected_checkin_time: z
    .string()
    .regex(/^(\d{2}:\d{2}(:\d{2})?)?$/, 'Use HH:MM')
    .transform((v) => v || null)
    .nullable()
    .default(null),
  // Four hours is already generous; beyond it the concept stops meaning
  // anything and the studio wants a later start time instead.
  late_grace_minutes: z.number().int().min(0).max(240).default(15),
  missed_cutoff_time: z
    .string()
    .regex(/^(\d{2}:\d{2}(:\d{2})?)?$/, 'Use HH:MM')
    .transform((v) => v || null)
    .nullable()
    .default(null),
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
  /** Set when an owner or admin corrected the day by hand. */
  corrected_by: uuid.nullable().default(null),
  correction_note: z.string().nullable().default(null),
  /** Minutes past the studio's expected start. 0 unless the status is 'late'. */
  late_minutes: z.number().int().default(0),
})
export type AttendanceDayRow = z.infer<typeof attendanceDayRow>

/** Paginated day-roster response — returned when page/page_size are requested. Array shape is kept otherwise. */
export const attendanceDayPage = z.object({
  items: attendanceDayRow.array(),
  total: z.number().int(),
  page: z.number().int(),
  page_size: z.number().int(),
})
export type AttendanceDayPage = z.infer<typeof attendanceDayPage>

/** An owner or admin fixing one person's day: forgot to tap in, wrong side of the fence. */
export const setAttendanceRequest = z
  .object({
    status: attendanceStatus,
    check_in_at: isoDateTime.nullable().optional(),
    check_out_at: isoDateTime.nullable().optional(),
    note: z.string().trim().max(300).optional(),
  })
  .refine(
    (v) => !v.check_in_at || !v.check_out_at || new Date(v.check_out_at) >= new Date(v.check_in_at),
    { message: 'Check-out must be after check-in.', path: ['check_out_at'] },
  )
export type SetAttendanceRequest = z.infer<typeof setAttendanceRequest>
