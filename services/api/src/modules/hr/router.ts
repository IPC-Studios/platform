import { Hono } from 'hono'
import { z } from '@ipc/contracts'
import {
  attendanceDayRow,
  attendanceRecord,
  checkInRequest,
  companyFence,
  setFenceRequest,
} from '@ipc/contracts'
import type { AppEnv } from '../../context'
import { requireAuth } from '../../middleware/auth'
import { requireModule } from '../../middleware/permissions'
import { fail } from '../../middleware/errors'
import { withUser } from '../../lib/db'

const list = attendanceRecord.array()

export const hrRouter = new Hono<AppEnv>()
  .use('*', requireAuth)

  .get('/attendance/my', async (c) => {
    const auth = c.get('auth')
    const rows = await withUser(
      c.env,
      auth.userId,
      (sql) => sql`
        select id, a_date, check_in_at, check_out_at, status
        from attendance where user_id = ${auth.userId}
        order by a_date desc limit 30`,
    ).catch(() => null)
    if (!rows) fail(400, 'We could not load attendance.')
    return c.json(list.parse(rows))
  })

  // The whole team's day. RLS decides what comes back: an admin or manager
  // sees everyone, anyone else sees themselves — so this needs no gate of its
  // own beyond the module.
  .get('/attendance', requireModule('attendance'), async (c) => {
    const date = c.req.query('date') ?? null
    if (date !== null && !/^\d{4}-\d{2}-\d{2}$/.test(date)) fail(422, 'Invalid date.')

    const rows = await withUser(
      c.env,
      c.get('auth').userId,
      (sql) => sql`
        select u.user_id, u.name, u.email, u.phone, u.engagement_type,
               coalesce(a.status, 'absent') as status,
               a.check_in_at, a.check_out_at
        from users u
        left join attendance a
          on a.user_id = u.user_id
         and a.a_date = coalesce(${date}::date, current_date)
        where u.deleted_at is null and u.status = 'active'
        order by u.name`,
    ).catch(() => null)
    if (!rows) fail(400, 'We could not load attendance.')
    return c.json(attendanceDayRow.array().parse(rows))
  })

  .post('/check-out', async (c) => {
    let id: string
    try {
      id = await withUser(c.env, c.get('auth').userId, async (sql) => {
        const rows = await sql`select check_out() as id`
        return rows[0]!.id as string
      })
    } catch (err) {
      if ((err as { message?: string })?.message?.includes('no_open_check_in')) {
        fail(422, 'You have not checked in today, or you already checked out.')
      }
      fail(400, 'We could not record your check-out.')
    }
    return c.json(z.object({ id: z.string() }).parse({ id: id! }))
  })

  .get('/location', async (c) => {
    const row = await withUser(c.env, c.get('auth').userId, async (sql) => {
      const rows = await sql`select lat, lng, radius_m, timezone from company_location`
      return rows[0] ?? null
    }).catch(() => null)
    return c.json(row ? companyFence.parse(row) : null)
  })

  // Owner-only, and enforced by the company_location RLS policy rather than a
  // check here: the function runs as the caller precisely so that holds.
  .patch('/location', async (c) => {
    const parsed = setFenceRequest.safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success) fail(422, 'Please check the location and radius.')
    const v = parsed.data

    const row = await withUser(c.env, c.get('auth').userId, async (sql) => {
      const rows = await sql`
        select * from set_company_location(${v.lat}, ${v.lng}, ${v.radius_m}, ${v.timezone})`
      return rows[0] ?? null
    }).catch(() => null)
    if (!row) fail(403, 'Only the studio owner can set the attendance location.')
    return c.json(companyFence.parse(row))
  })

  .post('/check-in', async (c) => {
    const parsed = checkInRequest.safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success) fail(422, 'Location is required to check in.')
    let id: string
    try {
      id = await withUser(c.env, c.get('auth').userId, async (sql) => {
        const rows = await sql`select check_in(p_lat => ${parsed.data.lat}, p_lng => ${parsed.data.lng}) as id`
        return rows[0]!.id as string
      })
    } catch (err) {
      if ((err as { message?: string })?.message?.includes('outside_fence')) {
        fail(422, 'You are too far from the studio to check in.')
      }
      fail(400, 'We could not record your check-in.')
    }
    return c.json(z.object({ id: z.string() }).parse({ id: id! }), 201)
  })
