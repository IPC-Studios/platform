import { Hono } from 'hono'
import { createShootRequest, shootListItem, updateShootRequest } from '@ipc/contracts'
import type { AppEnv } from '../../context'
import { requireAuth } from '../../middleware/auth'
import { requireAction } from '../../middleware/permissions'
import { fail } from '../../middleware/errors'
import { withUser } from '../../lib/db'

const list = shootListItem.array()

export const shootsRouter = new Hono<AppEnv>()
  .use('*', requireAuth)

  .get('/', requireAction('projects', 'view'), async (c) => {
    const project = c.req.query('project_id')
    const rows = await withUser(
      c.env,
      c.get('auth').userId,
      (sql) => sql`
        select s.id, s.name, s.project_id, s.shoot_date, s.location, s.status,
               p.name as project_name
        from shoots s
        left join projects p on p.id = s.project_id
        where ${project ? sql`s.project_id = ${project}` : sql`true`}
        order by s.shoot_date asc nulls last`,
    ).catch(() => null)
    if (!rows) fail(400, 'We could not load shoots.')
    return c.json(list.parse(rows))
  })

  .post('/', requireAction('projects', 'edit'), async (c) => {
    const parsed = createShootRequest.safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success) fail(422, 'Please check the shoot details.')
    const auth = c.get('auth')
    const row = await withUser(c.env, auth.userId, async (sql) => {
      const rows = await sql<{ id: string }[]>`
        insert into shoots ${sql({ ...parsed.data, company_id: auth.companyId })} returning id`
      return rows[0]
    }).catch(() => null)
    if (!row) fail(400, 'We could not create the shoot.')
    return c.json({ id: row.id }, 201)
  })

  .patch('/:id', requireAction('projects', 'edit'), async (c) => {
    const parsed = updateShootRequest.safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success) fail(422, 'Please check the shoot details.')
    const ok = await withUser(c.env, c.get('auth').userId, async (sql) => {
      await sql`update shoots set ${sql(parsed.data)} where id = ${c.req.param('id')!}`
      return true
    }).catch(() => false)
    if (!ok) fail(400, 'We could not update the shoot.')
    return c.body(null, 204)
  })
