import { Hono } from 'hono'
import { bookSlotRequest, setSlotStatusRequest, teamSlot } from '@ipc/contracts'
import type { AppEnv } from '../../context'
import { requireAuth } from '../../middleware/auth'
import { requireAction } from '../../middleware/permissions'
import { fail } from '../../middleware/errors'
import { withUser } from '../../lib/db'

export const allocationRouter = new Hono<AppEnv>()
  .use('*', requireAuth)

  .get('/', requireAction('projects', 'view'), async (c) => {
    const rows = await withUser(
      c.env,
      c.get('auth').userId,
      (sql) => sql`
        select s.id, s.user_id, s.shoot_id, s.service_name, s.start_at, s.end_at, s.status,
               s.estimated_cost, u.name as user_name
        from team_assignment_slots s
        left join users u on u.user_id = s.user_id
        order by s.start_at`,
    ).catch(() => null)
    if (!rows) fail(400, 'We could not load the schedule.')
    return c.json(teamSlot.array().parse(rows))
  })

  .post('/', requireAction('projects', 'edit'), async (c) => {
    const parsed = bookSlotRequest.safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success) fail(422, 'Please check the booking details.')
    const d = parsed.data
    let id: string | null = null
    try {
      id = await withUser(c.env, c.get('auth').userId, async (sql) => {
        const rows = await sql<{ id: string }[]>`
          select book_team_slot(
            p_user_id => ${d.user_id},
            p_shoot_id => ${d.shoot_id},
            p_service_name => ${d.service_name ?? null},
            p_start_at => ${d.start_at},
            p_end_at => ${d.end_at},
            p_estimated_cost => ${d.estimated_cost ?? null}
          ) as id`
        return rows[0]?.id ?? null
      })
    } catch (e) {
      // The overlap guard raises SQLSTATE 23P01 (exclusion violation).
      const err = e as { code?: string; message?: string }
      if (err.code === '23P01' || err.message?.includes('double_booking')) {
        fail(409, 'That member is already booked during this time.')
      }
      fail(400, 'We could not create the booking.')
    }
    if (!id) fail(400, 'We could not create the booking.')
    return c.json({ id }, 201)
  })

  .post('/:id/status', requireAction('projects', 'edit'), async (c) => {
    const parsed = setSlotStatusRequest.safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success) fail(422, 'Invalid status.')
    const ok = await withUser(c.env, c.get('auth').userId, async (sql) => {
      await sql`select set_team_slot_status(p_slot_id => ${c.req.param('id')!}, p_status => ${parsed.data.status})`
      return true
    }).catch(() => false)
    if (!ok) fail(400, 'We could not update the booking.')
    return c.body(null, 204)
  })
