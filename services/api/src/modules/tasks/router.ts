import { Hono } from 'hono'
import {
  createTaskRequest,
  generateTasksRequest,
  setBoardOrderRequest,
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
  status: string
  priority: string
  due_date: string | null
  project_id: string | null
  project_name: string | null
}

function toItems(rows: RawTask[], order: Map<string, number>) {
  return rows.map((r) => ({ ...r, sort_order: order.get(r.id) ?? 0 }))
}

// Flat select with the project name joined in (was PostgREST `projects(name)`).
const selectTasks = (sql: TransactionSql) => sql<RawTask[]>`
  select t.id, t.title, t.status, t.priority, t.due_date, t.project_id,
         p.name as project_name
  from tasks t
  left join projects p on p.id = t.project_id
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
      return rows[0]?.id ?? null
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
