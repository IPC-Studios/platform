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
import { requestClient } from '../../lib/supabase'

const list = taskListItem.array()

interface RawTask {
  id: string
  title: string
  status: string
  priority: string
  due_date: string | null
  project_id: string | null
  projects: { name: string } | null
}

function toItems(rows: RawTask[], order: Map<string, number>) {
  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    status: r.status,
    priority: r.priority,
    due_date: r.due_date,
    project_id: r.project_id,
    project_name: r.projects?.name ?? null,
    sort_order: order.get(r.id) ?? 0,
  }))
}

const SELECT = 'id,title,status,priority,due_date,project_id,projects(name)'

export const tasksRouter = new Hono<AppEnv>()
  .use('*', requireAuth)

  // ── Employee subset (any active member) ─────────────────────
  .get('/my', async (c) => {
    const { data, error } = await requestClient(c)
      .from('tasks')
      .select(SELECT)
      .order('created_at', { ascending: false })
    if (error) fail(400, 'We could not load your tasks.')
    // RLS already restricts employees to their assigned tasks.
    return c.json(list.parse(toItems((data ?? []) as unknown as RawTask[], new Map())))
  })

  .patch('/my/:id/status', async (c) => {
    const parsed = updateTaskStatusRequest.safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success) fail(422, 'Invalid status.')
    const { error } = await requestClient(c).rpc('update_my_task_status', {
      p_task_id: c.req.param('id'),
      p_status: parsed.data.status,
    })
    if (error) fail(403, 'You can only update tasks assigned to you.')
    return c.body(null, 204)
  })

  // ── Board (persisted drag order) ────────────────────────────
  .get('/board', requireAction('tasks', 'view'), async (c) => {
    const view = c.req.query('view') ?? 'default'
    const supabase = requestClient(c)
    const [{ data: tasks, error }, { data: orders }] = await Promise.all([
      supabase.from('tasks').select(SELECT),
      supabase.from('production_board_card_order').select('task_id,sort_order').eq('board_view', view),
    ])
    if (error) fail(400, 'We could not load the board.')
    const orderMap = new Map<string, number>(
      (orders ?? []).map((o) => [o.task_id as string, o.sort_order as number]),
    )
    return c.json(list.parse(toItems((tasks ?? []) as unknown as RawTask[], orderMap)))
  })

  .post('/board/order', requireAction('tasks', 'edit'), async (c) => {
    const parsed = setBoardOrderRequest.safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success) fail(422, 'Invalid board order payload.')
    const { error } = await requestClient(c).rpc('set_board_lane_order', {
      p_board_view: parsed.data.board_view,
      p_lane_key: parsed.data.lane_key,
      p_task_ids: parsed.data.task_ids,
    })
    if (error) fail(403, 'We could not save the board order.')
    return c.body(null, 204)
  })

  // ── Admin/manager task ops ──────────────────────────────────
  .get('/', requireAction('tasks', 'view'), async (c) => {
    const { data, error } = await requestClient(c)
      .from('tasks')
      .select(SELECT)
      .order('created_at', { ascending: false })
    if (error) fail(400, 'We could not load tasks.')
    return c.json(list.parse(toItems((data ?? []) as unknown as RawTask[], new Map())))
  })

  .post('/', requireAction('tasks', 'create'), async (c) => {
    const parsed = createTaskRequest.safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success) fail(422, 'Please check the task details.')
    const { data, error } = await requestClient(c).rpc('create_task_with_assignees', {
      p_project_id: parsed.data.project_id,
      p_deliverable_id: parsed.data.deliverable_id,
      p_title: parsed.data.title,
      p_status: parsed.data.status,
      p_priority: parsed.data.priority,
      p_due_date: parsed.data.due_date ?? null,
      p_assignees: parsed.data.assignees,
    })
    if (error || !data) fail(400, 'We could not create the task.')
    return c.json({ id: data as string }, 201)
  })

  .post('/generate', requireAction('tasks', 'create'), async (c) => {
    const parsed = generateTasksRequest.safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success) fail(422, 'A project is required.')
    const { data, error } = await requestClient(c).rpc('generate_tasks_for_project_deliverables', {
      p_project_id: parsed.data.project_id,
      p_assignees: parsed.data.assignees,
    })
    if (error) fail(400, 'We could not generate tasks.')
    return c.json({ created: Array.isArray(data) ? data.length : 0 }, 201)
  })

  .patch('/:id/status', requireAction('tasks', 'edit'), async (c) => {
    const parsed = updateTaskStatusRequest.safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success) fail(422, 'Invalid status.')
    const { error } = await requestClient(c)
      .from('tasks')
      .update({ status: parsed.data.status })
      .eq('id', c.req.param('id'))
    if (error) fail(400, 'We could not update the task.')
    return c.body(null, 204)
  })
