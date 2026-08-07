import { Hono } from 'hono'
import { bookSlotRequest, setSlotStatusRequest, teamSlot } from '@ipc/contracts'
import type { AppEnv } from '../../context'
import { requireAuth } from '../../middleware/auth'
import { requireAction } from '../../middleware/permissions'
import { fail } from '../../middleware/errors'
import { requestClient } from '../../lib/supabase'

interface RawSlot {
  id: string
  user_id: string
  shoot_id: string | null
  service_name: string | null
  start_at: string
  end_at: string
  status: string
  estimated_cost: number | null
  users: { name: string } | null
}

const SELECT = 'id,user_id,shoot_id,service_name,start_at,end_at,status,estimated_cost,users(name)'

export const allocationRouter = new Hono<AppEnv>()
  .use('*', requireAuth)

  .get('/', requireAction('projects', 'view'), async (c) => {
    const { data, error } = await requestClient(c)
      .from('team_assignment_slots')
      .select(SELECT)
      .order('start_at')
    if (error) fail(400, 'We could not load the schedule.')
    const rows = ((data ?? []) as unknown as RawSlot[]).map((r) => ({
      ...r,
      user_name: r.users?.name ?? null,
    }))
    return c.json(teamSlot.array().parse(rows))
  })

  .post('/', requireAction('projects', 'edit'), async (c) => {
    const parsed = bookSlotRequest.safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success) fail(422, 'Please check the booking details.')
    const { data, error } = await requestClient(c).rpc('book_team_slot', {
      p_user_id: parsed.data.user_id,
      p_shoot_id: parsed.data.shoot_id,
      p_service_name: parsed.data.service_name ?? null,
      p_start_at: parsed.data.start_at,
      p_end_at: parsed.data.end_at,
      p_estimated_cost: parsed.data.estimated_cost ?? null,
    })
    if (error) {
      // The overlap guard raises SQLSTATE 23P01 (exclusion violation).
      if (error.message.includes('double_booking') || error.code === '23P01') {
        fail(409, 'That member is already booked during this time.')
      }
      fail(400, 'We could not create the booking.')
    }
    return c.json({ id: data as string }, 201)
  })

  .post('/:id/status', requireAction('projects', 'edit'), async (c) => {
    const parsed = setSlotStatusRequest.safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success) fail(422, 'Invalid status.')
    const { error } = await requestClient(c).rpc('set_team_slot_status', {
      p_slot_id: c.req.param('id'),
      p_status: parsed.data.status,
    })
    if (error) fail(400, 'We could not update the booking.')
    return c.body(null, 204)
  })
