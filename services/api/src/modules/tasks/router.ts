import { Hono } from 'hono'
import {
  applyBundleRequest,
  createBundleRequest,
  createTaskRequest,
  generateTasksRequest,
  setBoardOrderRequest,
  taskBundle,
  taskListItem,
  updateTaskStatusRequest,
} from '@ipc/contracts'
import type { AppEnv } from '../../context'
import { requireAuth } from '../../middleware/auth'
import { requireAction } from '../../middleware/permissions'
import { fail } from '../../middleware/errors'
import { withUser } from '../../lib/db'
import type { TransactionSql } from 'postgres'

const list = taskListItem.array()

interface RawTask {
  id: string
  title: string
  description: string | null
  status: string
  priority: string
  due_date: string | null
  project_id: string | null
  project_name: string | null
  assignee_names: string[]
}

function toItems(rows: RawTask[], order: Map<string, number>) {
  return rows.map((r) => ({ ...r, sort_order: order.get(r.id) ?? 0 }))
}

// Flat select with the project name joined in (was PostgREST `projects(name)`).
const selectTasks = (sql: TransactionSql) => sql<RawTask[]>`
  select t.id, t.title, t.description, t.status, t.priority, t.due_date, t.project_id,
         p.name as project_name,
         coalesce(
           array_agg(u.name order by u.name) filter (where u.user_id is not null),
           '{}'::text[]
         ) as assignee_names
  from tasks t
  left join projects p on p.id = t.project_id
  left join task_assignees a on a.task_id = t.id
  left join users u on u.user_id = a.user_id
  group by t.id, p.name
  order by t.created_at desc`

export const tasksRouter = new Hono<AppEnv>()
  .use('*', requireAuth)

  // ── Employee subset (any active member) ─────────────────────
  .get('/my', async (c) => {
    // RLS already restricts employees to their assigned tasks.
    const rows = await withUser(c.env, c.get('auth').userId, selectTasks).catch(() => null)
    if (!rows) fail(400, 'We could not load your tasks.')
    return c.json(list.parse(toItems(rows, new Map())))
  })

  .patch('/my/:id/status', async (c) => {
    const parsed = updateTaskStatusRequest.safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success) fail(422, 'Invalid status.')
    const ok = await withUser(c.env, c.get('auth').userId, async (sql) => {
      await sql`select update_my_task_status(p_task_id => ${c.req.param('id')!}, p_status => ${parsed.data.status})`
      return true
    }).catch(() => false)
    if (!ok) fail(403, 'You can only update tasks assigned to you.')
    return c.body(null, 204)
  })

  // ── Board (persisted drag order) ────────────────────────────
  .get('/board', requireAction('tasks', 'view'), async (c) => {
    const view = c.req.query('view') ?? 'default'
    const result = await withUser(c.env, c.get('auth').userId, async (sql) => {
      const tasks = await selectTasks(sql)
      const orders = await sql<{ task_id: string; sort_order: number }[]>`
        select task_id, sort_order from production_board_card_order where board_view = ${view}`
      return { tasks, orders }
    }).catch(() => null)
    if (!result) fail(400, 'We could not load the board.')
    const orderMap = new Map(result.orders.map((o) => [o.task_id, o.sort_order]))
    return c.json(list.parse(toItems(result.tasks, orderMap)))
  })

  .post('/board/order', requireAction('tasks', 'edit'), async (c) => {
    const parsed = setBoardOrderRequest.safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success) fail(422, 'Invalid board order payload.')
    const d = parsed.data
    const ok = await withUser(c.env, c.get('auth').userId, async (sql) => {
      await sql`select set_board_lane_order(
        p_board_view => ${d.board_view}, p_lane_key => ${d.lane_key}, p_task_ids => ${d.task_ids}::uuid[])`
      return true
    }).catch(() => false)
    if (!ok) fail(403, 'We could not save the board order.')
    return c.body(null, 204)
  })

  // ── Admin/manager task ops ──────────────────────────────────
  .get('/', requireAction('tasks', 'view'), async (c) => {
    const rows = await withUser(c.env, c.get('auth').userId, selectTasks).catch(() => null)
    if (!rows) fail(400, 'We could not load tasks.')
    return c.json(list.parse(toItems(rows, new Map())))
  })

  .post('/', requireAction('tasks', 'create'), async (c) => {
    const parsed = createTaskRequest.safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success) fail(422, 'Please check the task details.')
    const d = parsed.data
    const id = await withUser(c.env, c.get('auth').userId, async (sql) => {
      const rows = await sql<{ id: string }[]>`
        select create_task_with_assignees(
          p_project_id => ${d.project_id},
          p_deliverable_id => ${d.deliverable_id},
          p_title => ${d.title},
          p_status => ${d.status},
          p_priority => ${d.priority},
          p_due_date => ${d.due_date ?? null},
          p_assignees => ${d.assignees}::uuid[]
        ) as id`
      const created = rows[0]?.id ?? null
      // The RPC predates descriptions; set it alongside rather than changing a
      // signature the board and the generator also call.
      if (created && d.description) {
        await sql`update tasks set description = ${d.description} where id = ${created}`
      }
      return created
    }).catch(() => null)
    if (!id) fail(400, 'We could not create the task.')
    return c.json({ id }, 201)
  })

  .post('/generate', requireAction('tasks', 'create'), async (c) => {
    const parsed = generateTasksRequest.safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success) fail(422, 'A project is required.')
    const d = parsed.data
    const created = await withUser(c.env, c.get('auth').userId, async (sql) => {
      const rows = await sql<{ id: string }[]>`
        select * from generate_tasks_for_project_deliverables(
          p_project_id => ${d.project_id}, p_assignees => ${d.assignees}::uuid[])`
      return rows.length
    }).catch(() => null)
    if (created === null) fail(400, 'We could not generate tasks.')
    return c.json({ created }, 201)
  })

  .patch('/:id/status', requireAction('tasks', 'edit'), async (c) => {
    const parsed = updateTaskStatusRequest.safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success) fail(422, 'Invalid status.')
    const ok = await withUser(c.env, c.get('auth').userId, async (sql) => {
      await sql`update tasks set ${sql({ status: parsed.data.status })} where id = ${c.req.param('id')!}`
      return true
    }).catch(() => false)
    if (!ok) fail(400, 'We could not update the task.')
    return c.body(null, 204)
  })

  // ── Task bundles ────────────────────────────────────────────
  // The checklists a studio repeats. These tables existed from Phase 5 but had
  // RLS on with no policy, so nothing could read them until 0031.
  .get('/bundles', requireAction('tasks', 'view'), async (c) => {
    const rows = await withUser(
      c.env,
      c.get('auth').userId,
      (sql) => sql`
        select b.id, b.name,
               coalesce(
                 jsonb_agg(
                   jsonb_build_object(
                     'id', i.id, 'title', i.title,
                     'priority', i.priority, 'sort_order', i.sort_order
                   ) order by i.sort_order, i.title
                 ) filter (where i.id is not null),
                 '[]'::jsonb
               ) as items
        from task_bundles b
        left join task_bundle_items i on i.bundle_id = b.id
        group by b.id
        order by b.name`,
    ).catch(() => null)
    if (!rows) fail(400, 'We could not load task bundles.')
    return c.json(taskBundle.array().parse(rows))
  })

  .post('/bundles', requireAction('tasks', 'create'), async (c) => {
    const parsed = createBundleRequest.safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success) fail(422, 'A bundle needs a name and at least one task.')
    const { name, items } = parsed.data
    const companyId = c.get('auth').companyId

    const id = await withUser(c.env, c.get('auth').userId, async (sql) => {
      const [bundle] = await sql<{ id: string }[]>`
        insert into task_bundles (company_id, name) values (${companyId}, ${name}) returning id`
      if (!bundle) return null
      for (const [index, item] of items.entries()) {
        await sql`
          insert into task_bundle_items (bundle_id, company_id, title, priority, sort_order)
          values (${bundle.id}, ${companyId}, ${item.title}, ${item.priority}, ${index})`
      }
      return bundle.id
    }).catch(() => null)

    if (!id) fail(400, 'We could not create this bundle.')
    return c.json({ id }, 201)
  })

  .delete('/bundles/:id', requireAction('tasks', 'delete'), async (c) => {
    const rows = await withUser(
      c.env,
      c.get('auth').userId,
      (sql) => sql<{ id: string }[]>`
        delete from task_bundles where id = ${c.req.param('id')!} returning id`,
    ).catch(() => null)
    if (!rows) fail(400, 'We could not delete this bundle.')
    if (!rows.length) fail(404, 'We could not find that bundle.')
    return c.body(null, 204)
  })

  // Stamp the checklist out as real tasks.
  .post('/bundles/:id/apply', requireAction('tasks', 'create'), async (c) => {
    const parsed = applyBundleRequest.safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success) fail(422, 'Please check the project and assignees.')
    const d = parsed.data

    const created = await withUser(c.env, c.get('auth').userId, async (sql) => {
      const rows = await sql<{ count: number }[]>`
        select apply_task_bundle(
          ${c.req.param('id')!}::uuid, ${d.project_id}, ${d.assignees}::uuid[]
        ) as count`
      return rows[0]?.count ?? null
    }).catch(() => null)

    if (created === null) fail(400, 'We could not apply this bundle.')
    return c.json({ created }, 201)
  })
