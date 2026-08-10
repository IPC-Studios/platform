import { Hono } from 'hono'
import { z } from '@ipc/contracts'
import { attendanceRecord, checkInRequest, companyFence } from '@ipc/contracts'
import type { AppEnv } from '../../context'
import { requireAuth } from '../../middleware/auth'
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

  .get('/location', async (c) => {
    const row = await withUser(c.env, c.get('auth').userId, async (sql) => {
      const rows = await sql`select lat, lng, radius_m from company_location`
      return rows[0] ?? null
    }).catch(() => null)
    return c.json(row ? companyFence.parse(row) : null)
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
