import { Hono } from 'hono'
import { createShootRequest, shootListItem, updateShootRequest } from '@ipc/contracts'
import type { AppEnv } from '../../context'
import { requireAuth } from '../../middleware/auth'
import { requireAction } from '../../middleware/permissions'
import { fail } from '../../middleware/errors'
import { uuidParam } from '../../lib/params'
import type { TransactionSql } from 'postgres'
import { withUser } from '../../lib/db'
import { attempt } from '../../lib/attempt'
import { audit } from '../../lib/audit'

const list = shootListItem.array()

/** The shared projection, as a fragment the two list queries embed. */
const selectShoots = (sql: TransactionSql) => sql`
  select s.id, s.name, s.project_id, s.shoot_date, s.location, s.status,
         p.name as project_name
  from shoots s
  left join projects p on p.id = s.project_id`

export const shootsRouter = new Hono<AppEnv>()
  .use('*', requireAuth)

  // The caller's own shoots: every shoot they hold a booking slot on. Needs no
  // module gate — RLS on the slots table already scopes what comes back.
  // Declared before '/' so a query-less GET does not swallow it.
  .get('/my', async (c) => {
    const auth = c.get('auth')
    const rows = await attempt(c, 'shoots.my', () =>
      withUser(
        c.env,
        auth.userId,
        (sql) => sql`
          ${selectShoots(sql)}
          where s.status <> 'cancelled'
            and exists (
              select 1 from team_assignment_slots t
              where t.shoot_id = s.id and t.user_id = ${auth.userId} and t.status <> 'cancelled'
            )
          order by s.shoot_date asc nulls last`,
      ),
    )
    if (!rows) fail(400, 'We could not load your shoots.')
    return c.json(list.parse(rows))
  })

  .get('/', requireAction('projects', 'view'), async (c) => {
    const project = c.req.query('project_id')
    const rows = await attempt(c, 'shoots.list', () =>
      withUser(
        c.env,
        c.get('auth').userId,
        (sql) => sql`
          ${selectShoots(sql)}
          where ${project ? sql`s.project_id = ${project}` : sql`true`}
          order by s.shoot_date asc nulls last`,
      ),
    )
    if (!rows) fail(400, 'We could not load shoots.')
    return c.json(list.parse(rows))
  })

  .post('/', requireAction('projects', 'edit'), async (c) => {
    const parsed = createShootRequest.safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success) fail(422, 'Please check the shoot details.')
    const auth = c.get('auth')
    const row = await attempt(c, 'shoots.create', () =>
      withUser(c.env, auth.userId, async (sql) => {
        const rows = await sql<{ id: string }[]>`
          insert into shoots ${sql({ ...parsed.data, company_id: auth.companyId })} returning id`
        return rows[0] ?? null
      }),
    )
    if (!row) fail(400, 'We could not create the shoot.')
    await audit(c, { action: 'shoot.create', entityType: 'shoot', entityId: row.id, after: parsed.data })
    return c.json({ id: row.id }, 201)
  })

  .patch('/:id', requireAction('projects', 'edit'), async (c) => {
    const parsed = updateShootRequest.safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success) fail(422, 'Please check the shoot details.')
    if (Object.keys(parsed.data).length === 0) return c.body(null, 204)
    const id = uuidParam(c)
    const rows = await attempt(c, 'shoots.update', () =>
      withUser(
        c.env,
        c.get('auth').userId,
        (sql) => sql<{ id: string }[]>`update shoots set ${sql(parsed.data)} where id = ${id} returning id`,
      ),
    )
    if (!rows) fail(400, 'We could not update the shoot.')
    if (!rows.length) fail(404, 'That shoot was not found.')
    await audit(c, { action: 'shoot.update', entityType: 'shoot', entityId: id, after: parsed.data })
    return c.body(null, 204)
  })
