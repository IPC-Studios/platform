import { Hono } from 'hono'
import {
  notification,
  notificationGeneratorKey,
  runGeneratorRequest,
  runGeneratorResponse,
  unreadCountResponse,
} from '@ipc/contracts'
import type { AppEnv } from '../../context'
import { requireAuth } from '../../middleware/auth'
import { fail } from '../../middleware/errors'
import { uuidParam } from '../../lib/params'
import { withUser } from '../../lib/db'
import { attempt } from '../../lib/attempt'
import { audit } from '../../lib/audit'

const list = notification.array()

const bool = (v: string | undefined): boolean => v === '1' || v === 'true'

export const notificationsRouter = new Hono<AppEnv>()
  .use('*', requireAuth)

  /**
   * The list, with the filters Lovable's alert centre had: unread only,
   * severity, type (or a type prefix like `invoice.`), a date window, and
   * whether dismissed rows come back at all.
   */
  .get('/', async (c) => {
    const unreadOnly = bool(c.req.query('unread_only'))
    const includeDismissed = bool(c.req.query('include_dismissed'))
    const severity = c.req.query('severity')
    const type = (c.req.query('type') ?? '').trim()
    const typePrefix = (c.req.query('type_prefix') ?? '').trim()
    const dateFrom = c.req.query('date_from')
    const dateTo = c.req.query('date_to')
    if (severity && !['info', 'warning', 'critical'].includes(severity)) fail(422, 'That severity is not valid.')
    for (const d of [dateFrom, dateTo]) if (d && Number.isNaN(Date.parse(d))) fail(422, 'That date is not valid.')
    const limitRaw = Number(c.req.query('limit') ?? 50)
    const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(Math.trunc(limitRaw), 1), 100) : 50

    const rows = await attempt(c, 'notifications.list', () =>
      withUser(
        c.env,
        c.get('auth').userId,
        (sql) => sql`
          select id, type, severity, title, body, read_at, dismissed_at,
                 deep_link, meta, entity_type, entity_id, created_at
            from notifications
           where ${unreadOnly ? sql`read_at is null` : sql`true`}
             and ${includeDismissed ? sql`true` : sql`dismissed_at is null`}
             and ${severity ? sql`severity = ${severity}` : sql`true`}
             and ${type ? sql`type = ${type}` : sql`true`}
             and ${typePrefix ? sql`type like ${typePrefix + '%'}` : sql`true`}
             and ${dateFrom ? sql`created_at >= ${dateFrom}` : sql`true`}
             and ${dateTo ? sql`created_at <= ${dateTo}` : sql`true`}
           order by created_at desc
           limit ${limit}`,
      ),
    )
    if (!rows) fail(400, 'We could not load notifications.')
    return c.json(list.parse(rows))
  })

  /** One number for the bell. Unread means not read AND not dismissed. */
  .get('/unread-count', async (c) => {
    const rows = await attempt(c, 'notifications.unread_count', () =>
      withUser(
        c.env,
        c.get('auth').userId,
        (sql) => sql<{ n: number }[]>`select unread_notifications_count() as n`,
      ),
    )
    if (!rows) fail(400, 'We could not load your alert count.')
    return c.json(unreadCountResponse.parse({ unread_count: rows[0]?.n ?? 0 }))
  })

  .post('/:id/read', async (c) => {
    const id = uuidParam(c)
    const rows = await attempt(c, 'notifications.read', () =>
      withUser(
        c.env,
        c.get('auth').userId,
        (sql) => sql<{ id: string }[]>`
          update notifications set read_at = coalesce(read_at, now()) where id = ${id} returning id`,
      ),
    )
    if (!rows) fail(400, 'We could not update the notification.')
    if (!rows.length) fail(404, 'That notification was not found.')
    await audit(c, { action: 'notification.read', entityType: 'notification', entityId: id })
    return c.body(null, 204)
  })

  /**
   * Dismiss is a timestamp, not a delete, so the history stays queryable and
   * "include dismissed" can bring a row back into view.
   */
  .post('/:id/dismiss', async (c) => {
    const id = uuidParam(c)
    const rows = await attempt(c, 'notifications.dismiss', () =>
      withUser(
        c.env,
        c.get('auth').userId,
        (sql) => sql<{ ok: boolean }[]>`select dismiss_notification(${id}) as ok`,
      ),
    )
    if (!rows) fail(400, 'We could not dismiss that notification.')
    if (rows[0]?.ok === false) fail(404, 'That notification was not found.')
    await audit(c, { action: 'notification.dismiss', entityType: 'notification', entityId: id })
    return c.body(null, 204)
  })

  .post('/read-all', async (c) => {
    const ok = await attempt(c, 'notifications.read_all', () =>
      withUser(c.env, c.get('auth').userId, async (sql) => {
        await sql`update notifications set read_at = now() where read_at is null`
        return true
      }),
    )
    if (!ok) fail(400, 'We could not update your notifications.')
    await audit(c, { action: 'notification.read_all', entityType: 'notification' })
    return c.body(null, 204)
  })

  /** The generator keys, so the test centre renders from the server's list. */
  .get('/generators', async (c) => c.json(notificationGeneratorKey.options))

  /**
   * Run one generator. Defaults to a dry run: the destructive direction has to
   * be asked for, because the non-dry version emails people.
   */
  .post('/generators/run', async (c) => {
    const auth = c.get('auth')
    if (!auth.isOwner && auth.role !== 'admin' && auth.role !== 'manager') {
      fail(403, 'Only admins and managers can run notification generators.')
    }
    const parsed = runGeneratorRequest.safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success) fail(422, 'Pick a generator to run.')
    const { key, dry_run, date_from, date_to } = parsed.data

    const rows = await attempt(c, 'notifications.run_generator', () =>
      withUser(
        c.env,
        auth.userId,
        (sql) => sql<{ result: unknown }[]>`
          select run_notification_generator(
            ${key}, ${dry_run}, ${date_from ?? null}, ${date_to ?? null}) as result`,
      ),
    )
    if (!rows?.length) fail(400, 'That generator could not run.')
    if (!dry_run) {
      await audit(c, { action: 'notification.generator_run', entityType: 'notification', after: { key } })
    }
    return c.json(runGeneratorResponse.parse(rows[0]!.result))
  })
