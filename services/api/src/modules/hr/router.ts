import { Hono } from 'hono'
import {
  attendanceDayRow,
  attendanceRecord,
  checkInRequest,
  companyFence,
  setAttendanceRequest,
  setFenceRequest,
  z,
} from '@ipc/contracts'
import type { AppEnv } from '../../context'
import { requireAuth } from '../../middleware/auth'
import { requireModule } from '../../middleware/permissions'
import { fail } from '../../middleware/errors'
import { uuidParam, dateParam } from '../../lib/params'
import { withUser } from '../../lib/db'
import { attempt } from '../../lib/attempt'
import { audit } from '../../lib/audit'

const list = attendanceRecord.array()
const idOnly = z.object({ id: z.string() })
const DATE = /^\d{4}-\d{2}-\d{2}$/

/** The RPCs signal their own refusals as P0001 with a leading keyword. */
const rpcReason = (err: unknown): string => String((err as { message?: string })?.message ?? '')

export const hrRouter = new Hono<AppEnv>()
  .use('*', requireAuth)

  .get('/attendance/my', async (c) => {
    const auth = c.get('auth')
    const rows = await attempt(c, 'hr.attendance_my', () =>
      withUser(
        c.env,
        auth.userId,
        (sql) => sql`
          select id, a_date, check_in_at, check_out_at, status
          from attendance where user_id = ${auth.userId}
          order by a_date desc limit 30`,
      ),
    )
    if (!rows) fail(400, 'We could not load attendance.')
    return c.json(list.parse(rows))
  })

  // The whole team's day. RLS decides what comes back: an admin or manager
  // sees everyone, anyone else sees themselves — so this needs no gate of its
  // own beyond the module.
  .get('/attendance', requireModule('attendance'), async (c) => {
    const date = c.req.query('date') ?? null
    if (date !== null && !DATE.test(date)) fail(422, 'Invalid date.')

    const rows = await attempt(c, 'hr.attendance_day', () =>
      withUser(
        c.env,
        c.get('auth').userId,
        (sql) => sql`
          select u.user_id, u.name, u.email, u.phone, u.engagement_type,
                 coalesce(a.status, 'absent') as status,
                 a.check_in_at, a.check_out_at, a.corrected_by, a.correction_note
          from users u
          left join attendance a
            on a.user_id = u.user_id
           and a.a_date = coalesce(${date}::date, current_date)
          where u.deleted_at is null and u.status = 'active'
          order by u.name`,
      ),
    )
    if (!rows) fail(400, 'We could not load attendance.')
    return c.json(attendanceDayRow.array().parse(rows))
  })

  // Manual correction: the owner or an admin fixes a day for someone who
  // forgot to tap in, or tapped in from the wrong side of the fence. Recorded
  // as a correction on the row AND in the audit trail.
  .put('/attendance/:userId/:date', requireModule('attendance'), async (c) => {
    const userId = uuidParam(c, 'userId')
    const date = dateParam(c, 'date')
    const parsed = setAttendanceRequest.safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success) fail(422, 'Please check the times and status.')
    const v = parsed.data
    const auth = c.get('auth')
    if (!auth.isOwner && auth.role !== 'admin') fail(403, 'You do not have access to this action.')

    const row = await attempt(
      c,
      'hr.attendance_correct',
      () =>
        withUser(c.env, auth.userId, async (sql) => {
          const rows = await sql<{ id: string }[]>`
            select set_attendance_manual(
              p_user_id => ${userId},
              p_date => ${date}::date,
              p_status => ${v.status},
              p_check_in_at => ${v.check_in_at ?? null},
              p_check_out_at => ${v.check_out_at ?? null},
              p_note => ${v.note ?? null}
            ) as id`
          return rows[0] ?? null
        }),
      { onCode: (code, err) => (code === 'P0001' && rpcReason(err).includes('unknown_member') ? 'missing' : undefined) },
    )
    if (row === 'missing') fail(404, 'We could not find that team member.')
    if (!row) fail(400, 'We could not save the correction.')
    await audit(c, {
      action: 'attendance.correct',
      entityType: 'attendance',
      entityId: row.id,
      after: { user_id: userId, date, ...v },
    })
    return c.json(idOnly.parse(row))
  })

  .post('/check-out', async (c) => {
    const id = await attempt(
      c,
      'hr.check_out',
      () =>
        withUser(c.env, c.get('auth').userId, async (sql) => {
          const rows = await sql<{ id: string }[]>`select check_out() as id`
          return rows[0]?.id ?? null
        }),
      { onCode: (code, err) => (code === 'P0001' && rpcReason(err).includes('no_open_check_in') ? 'no_open' : undefined) },
    )
    if (id === 'no_open') fail(422, 'You have not checked in today, or you already checked out.')
    if (!id) fail(400, 'We could not record your check-out.')
    await audit(c, { action: 'attendance.check_out', entityType: 'attendance', entityId: id })
    return c.json(idOnly.parse({ id }))
  })

  .get('/location', async (c) => {
    const row = await attempt(c, 'hr.location', () =>
      withUser(c.env, c.get('auth').userId, async (sql) => {
        const rows = await sql`select lat, lng, radius_m, timezone from company_location`
        return rows[0] ?? null
      }),
    )
    return c.json(row ? companyFence.parse(row) : null)
  })

  // Owner-only, and enforced by the company_location RLS policy rather than a
  // check here: the function runs as the caller precisely so that holds.
  .patch('/location', async (c) => {
    const parsed = setFenceRequest.safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success) fail(422, 'Please check the location and radius.')
    const v = parsed.data

    const row = await attempt(c, 'hr.location_set', () =>
      withUser(c.env, c.get('auth').userId, async (sql) => {
        const rows = await sql`
          select * from set_company_location(${v.lat}, ${v.lng}, ${v.radius_m}, ${v.timezone})`
        return rows[0] ?? null
      }),
    )
    if (!row) fail(403, 'Only the studio owner can set the attendance location.')
    await audit(c, { action: 'attendance.fence_set', entityType: 'company_location', after: v })
    return c.json(companyFence.parse(row))
  })

  .post('/check-in', async (c) => {
    const parsed = checkInRequest.safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success) fail(422, 'Location is required to check in.')
    const id = await attempt(
      c,
      'hr.check_in',
      () =>
        withUser(c.env, c.get('auth').userId, async (sql) => {
          const rows = await sql<{ id: string }[]>`
            select check_in(p_lat => ${parsed.data.lat}, p_lng => ${parsed.data.lng}) as id`
          return rows[0]?.id ?? null
        }),
      { onCode: (code, err) => (code === 'P0001' && rpcReason(err).includes('outside_fence') ? 'outside' : undefined) },
    )
    if (id === 'outside') fail(422, 'You are too far from the studio to check in.')
    if (!id) fail(400, 'We could not record your check-in.')
    await audit(c, { action: 'attendance.check_in', entityType: 'attendance', entityId: id })
    return c.json(idOnly.parse({ id }), 201)
  })
