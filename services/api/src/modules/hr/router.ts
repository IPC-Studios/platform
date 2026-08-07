import { Hono } from 'hono'
import { z } from '@ipc/contracts'
import { attendanceRecord, checkInRequest, companyFence } from '@ipc/contracts'
import type { AppEnv } from '../../context'
import { requireAuth } from '../../middleware/auth'
import { fail } from '../../middleware/errors'
import { requestClient } from '../../lib/supabase'

const list = attendanceRecord.array()

export const hrRouter = new Hono<AppEnv>()
  .use('*', requireAuth)

  .get('/attendance/my', async (c) => {
    const { data, error } = await requestClient(c)
      .from('attendance')
      .select('id,a_date,check_in_at,check_out_at,status')
      .eq('user_id', c.get('auth').userId)
      .order('a_date', { ascending: false })
      .limit(30)
    if (error) fail(400, 'We could not load attendance.')
    return c.json(list.parse(data ?? []))
  })

  .get('/location', async (c) => {
    const { data } = await requestClient(c)
      .from('company_location')
      .select('lat,lng,radius_m')
      .maybeSingle()
    return c.json(data ? companyFence.parse(data) : null)
  })

  .post('/check-in', async (c) => {
    const parsed = checkInRequest.safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success) fail(422, 'Location is required to check in.')
    const { data, error } = await requestClient(c).rpc('check_in', {
      p_lat: parsed.data.lat,
      p_lng: parsed.data.lng,
    })
    if (error) {
      if (error.message.includes('outside_fence')) {
        fail(422, 'You are too far from the studio to check in.')
      }
      fail(400, 'We could not record your check-in.')
    }
    return c.json(z.object({ id: z.string() }).parse({ id: data as string }), 201)
  })
