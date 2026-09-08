import { Hono } from 'hono'
import {
  createReminderRequest,
  reminderList,
  z,
} from '@ipc/contracts'
import type { AppEnv } from '../../context'
import { requireAuth } from '../../middleware/auth'
import { fail } from '../../middleware/errors'
import { uuidParam } from '../../lib/params'
import { withUser } from '../../lib/db'
import { attempt } from '../../lib/attempt'
import { audit } from '../../lib/audit'

const okResponse = z.object({ ok: z.boolean() })

/**
 * Reminders — dedicated reminder management with entity linking.
 * All authenticated users can manage their own reminders.
 */
export const remindersRouter = new Hono<AppEnv>()
  .use('*', requireAuth)

  .get('/', async (c) => {
    const rawStatus = c.req.query('status') || null
    const rawPriority = c.req.query('priority') || null
    const rawUserId = c.req.query('user_id') || null
    if (rawUserId) {
      const uc = z.string().uuid().safeParse(rawUserId)
      if (!uc.success) fail(422, 'Invalid user ID.')
    }
    // Normalize empty/undefined to null for SQL
    const status = rawStatus || null
    const priority = rawPriority || null
    const userId = rawUserId || null

    const rows = await attempt(c, 'reminders.list', () =>
      withUser(c.env, c.get('auth').userId, async (sql) => {
        const result = await sql<{ list_reminders: string }[]>`
          select list_reminders(
            p_status => ${status}::text,
            p_priority => ${priority}::text,
            p_user_id => ${userId}::uuid
          ) as list_reminders`
        return JSON.parse(result[0]?.list_reminders ?? '{"items":[],"summary":{"total_count":0,"active_count":0,"overdue_count":0,"due_today_count":0}}')
      }),
    )
    if (!rows) fail(400, 'We could not load reminders.')
    return c.json(reminderList.parse(rows))
  })

  .post('/', async (c) => {
    const parsed = createReminderRequest.safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success) fail(422, 'Please check the reminder details.')
    const auth = c.get('auth')
    const d = parsed.data
    const rows = await attempt(c, 'reminders.create', () =>
      withUser(c.env, auth.userId, async (sql) => {
        const made = await sql<{ id: string }[]>`
          insert into reminders (company_id, user_id, title, description, priority, entity_type, entity_id, due_at)
          values (${auth.companyId}, ${auth.userId}, ${d.title}, ${d.description ?? null},
                  ${d.priority}, ${d.entity_type ?? null}, ${d.entity_id ?? null}, ${d.due_at ?? null})
          returning id`
        return made
      }),
    )
    if (!rows?.[0]) fail(400, 'We could not create this reminder.')
    await audit(c, { action: 'reminder.create', entityType: 'reminder', entityId: rows[0].id, after: { title: d.title } })
    return c.json({ id: rows[0].id }, 201)
  })

  .patch('/:id', async (c) => {
    const id = uuidParam(c)
    const parsed = createReminderRequest.safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success) fail(422, 'Please check the reminder details.')
    const auth = c.get('auth')
    const d = parsed.data
    const rows = await attempt(c, 'reminders.update', () =>
      withUser(c.env, auth.userId, async (sql) => {
        return sql<{ id: string }[]>`
          update reminders
             set title = ${d.title}, description = ${d.description ?? null},
                 priority = ${d.priority}, entity_type = ${d.entity_type ?? null},
                 entity_id = ${d.entity_id ?? null}, due_at = ${d.due_at ?? null}::timestamptz
           where id = ${id} and company_id = ${auth.companyId} and user_id = ${auth.userId}
           returning id`
      }),
    )
    if (!rows) fail(400, 'We could not save this reminder.')
    if (!rows.length) fail(404, 'We could not find that reminder.')
    await audit(c, { action: 'reminder.update', entityType: 'reminder', entityId: id, after: d })
    return c.json(okResponse.parse({ ok: true }))
  })

  .patch('/:id/status', async (c) => {
    const id = uuidParam(c)
    const body = await c.req.json().catch(() => ({}))
    const status = z.enum(['active', 'completed', 'dismissed']).safeParse(body.status)
    if (!status.success) fail(422, 'Invalid status.')
    const auth = c.get('auth')
    const rows = await attempt(c, 'reminders.status', () =>
      withUser(c.env, auth.userId, async (sql) => {
        return sql<{ id: string }[]>`
          update reminders
             set status = ${status.data}
           where id = ${id} and company_id = ${auth.companyId} and user_id = ${auth.userId}
           returning id`
      }),
    )
    if (!rows) fail(400, 'We could not update this reminder.')
    if (!rows.length) fail(404, 'We could not find that reminder.')
    await audit(c, { action: 'reminder.status', entityType: 'reminder', entityId: id, after: { status: status.data } })
    return c.json(okResponse.parse({ ok: true }))
  })

  .delete('/:id', async (c) => {
    const id = uuidParam(c)
    const auth = c.get('auth')
    const rows = await attempt(c, 'reminders.delete', () =>
      withUser(c.env, auth.userId, async (sql) => {
        return sql<{ id: string }[]>`
          delete from reminders where id = ${id} and company_id = ${auth.companyId} and user_id = ${auth.userId} returning id`
      }),
    )
    if (!rows) fail(400, 'We could not delete this reminder.')
    if (!rows.length) fail(404, 'We could not find that reminder.')
    await audit(c, { action: 'reminder.delete', entityType: 'reminder', entityId: id })
    return c.json(okResponse.parse({ ok: true }))
  })
