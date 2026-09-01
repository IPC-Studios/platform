import { Hono } from 'hono'
import {
  createProjectRequest,
  deliverableInput,
  paymentInput,
  projectDetail,
  projectListItem,
  projectTrackingRow,
  updateProjectRequest,
} from '@ipc/contracts'
import type { AppEnv } from '../../context'
import { requireAuth } from '../../middleware/auth'
import { requireAction } from '../../middleware/permissions'
import { fail } from '../../middleware/errors'
import { withUser } from '../../lib/db'

export const projectsRouter = new Hono<AppEnv>()
  .use('*', requireAuth)

  .get('/', requireAction('projects', 'view'), async (c) => {
    const rows = await withUser(
      c.env,
      c.get('auth').userId,
      (sql) => sql`
        select p.id, p.name, p.status, p.client_id, p.package_cost, p.total_cost, p.created_at,
               cl.name as client_name
        from projects p
        left join clients cl on cl.id = p.client_id
        order by p.created_at desc`,
    ).catch(() => null)
    if (!rows) fail(400, 'We could not load your projects.')
    return c.json(projectListItem.array().parse(rows))
  })

  // Tracking: one aggregate row per project. Counting happens here — it is a
  // handful of indexed rollups the database does far better than N round trips
  // — but nothing is judged here. The scoring lives in @ipc/domain so the rules
  // are testable and the client can re-sort without asking again.
  //
  // `/tracking` must be declared before `/:id`, or Hono matches it as an id.
  .get('/tracking', requireAction('projects', 'view'), async (c) => {
    const rows = await withUser(
      c.env,
      c.get('auth').userId,
      (sql) => sql`
        select
          p.id, p.name, p.status, p.total_cost, cl.name as client_name,
          coalesce(t.total, 0)::int        as tasks_total,
          coalesce(t.done, 0)::int         as tasks_done,
          coalesce(t.overdue, 0)::int      as tasks_overdue,
          coalesce(d.total, 0)::int        as deliverables_total,
          coalesce(d.done, 0)::int         as deliverables_done,
          coalesce(dr.total, 0)::int       as data_records_total,
          coalesce(dr.unverified, 0)::int  as data_records_unverified,
          coalesce(w.pending, 0)::int      as pending_reviews,
          coalesce(s.total, 0)::int        as shoots_total,
          coalesce(s.done, 0)::int         as shoots_done,
          s.next_shoot_date,
          greatest(p.updated_at, coalesce(t.last_touch, p.updated_at)) as last_activity_at
        from projects p
        left join clients cl on cl.id = p.client_id
        left join lateral (
          select count(*) as total,
                 count(*) filter (where status = 'completed') as done,
                 count(*) filter (
                   where status not in ('completed', 'cancelled')
                     and due_date is not null and due_date < current_date
                 ) as overdue,
                 max(updated_at) as last_touch
          from tasks where project_id = p.id
        ) t on true
        left join lateral (
          select count(*) as total,
                 count(*) filter (where status = 'completed') as done
          from deliverables where project_id = p.id
        ) d on true
        left join lateral (
          -- Shoot-linked records only: a loose record is not a custody risk
          -- against any particular shoot.
          select count(*) as total,
                 count(*) filter (
                   where primary_status <> 'verified' or backup_status <> 'verified'
                 ) as unverified
          from shoot_data_records where project_id = p.id and shoot_id is not null
        ) dr on true
        left join lateral (
          select count(*) filter (where status = 'submitted') as pending
          from team_work_submissions where project_id = p.id
        ) w on true
        left join lateral (
          select count(*) as total,
                 count(*) filter (where status = 'completed') as done,
                 min(shoot_date) filter (where shoot_date >= current_date) as next_shoot_date
          from shoots where project_id = p.id and status <> 'cancelled'
        ) s on true
        where p.status <> 'cancelled'
        order by p.created_at desc`,
    ).catch(() => null)
    if (!rows) fail(400, 'We could not load project tracking.')
    return c.json(projectTrackingRow.array().parse(rows))
  })

  .post('/', requireAction('projects', 'create'), async (c) => {
    const parsed = createProjectRequest.safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success) fail(422, 'Please check the project details and try again.')
    const d = parsed.data
    const id = await withUser(c.env, c.get('auth').userId, async (sql) => {
      const rows = await sql<{ id: string }[]>`
        select create_project_with_details(
          p_client_id => ${d.client_id},
          p_name => ${d.name},
          p_package_cost => ${d.package_cost},
          p_status => ${d.status},
          p_show_quotation => ${d.show_quotation},
          p_deliverables => ${sql.json(d.deliverables)},
          p_payments => ${sql.json(d.payments)}
        ) as id`
      return rows[0]?.id ?? null
    }).catch(() => null)
    if (!id) fail(400, 'We could not create this project.')
    return c.json({ id }, 201)
  })

  .get('/:id', requireAction('projects', 'view'), async (c) => {
    const row = await withUser(c.env, c.get('auth').userId, async (sql) => {
      const rows = await sql`
        select p.id, p.name, p.status, p.client_id, p.package_cost,
               p.additional_deliverables_cost, p.total_cost, p.show_quotation, p.created_at,
               coalesce((
                 select jsonb_agg(to_jsonb(d) order by d.created_at)
                 from deliverables d where d.project_id = p.id
               ), '[]'::jsonb) as deliverables,
               coalesce((
                 select jsonb_agg(jsonb_build_object(
                   'id', rp.id, 'amount', rp.amount, 'paid_on', rp.paid_on,
                   'mode', rp.mode, 'reference', rp.reference) order by rp.paid_on)
                 from received_payments rp where rp.project_id = p.id
               ), '[]'::jsonb) as payments
        from projects p
        where p.id = ${c.req.param('id')!}`
      return rows[0]
    }).catch(() => null)
    if (!row) fail(404, 'That project was not found.')
    return c.json(projectDetail.parse(row))
  })

  .patch('/:id', requireAction('projects', 'edit'), async (c) => {
    const parsed = updateProjectRequest.safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success) fail(422, 'Please check the project details.')
    const ok = await withUser(c.env, c.get('auth').userId, async (sql) => {
      await sql`update projects set ${sql(parsed.data)} where id = ${c.req.param('id')!}`
      return true
    }).catch(() => false)
    if (!ok) fail(400, 'We could not update the project.')
    return c.body(null, 204)
  })

  // Add a deliverable to an existing project; the DB trigger recomputes totals.
  .post('/:id/deliverables', requireAction('projects', 'edit'), async (c) => {
    const parsed = deliverableInput.safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success) fail(422, 'Please check the deliverable details.')
    const auth = c.get('auth')
    const ok = await withUser(c.env, auth.userId, async (sql) => {
      await sql`insert into deliverables ${sql({ ...parsed.data, project_id: c.req.param('id')!, company_id: auth.companyId })}`
      return true
    }).catch(() => false)
    if (!ok) fail(400, 'We could not add the deliverable.')
    return c.body(null, 201)
  })

  .delete('/:id/deliverables/:did', requireAction('projects', 'edit'), async (c) => {
    const ok = await withUser(c.env, c.get('auth').userId, async (sql) => {
      await sql`delete from deliverables where id = ${c.req.param('did')!} and project_id = ${c.req.param('id')!}`
      return true
    }).catch(() => false)
    if (!ok) fail(400, 'We could not remove the deliverable.')
    return c.body(null, 204)
  })

  // Record a payment against a project.
  .post('/:id/payments', requireAction('projects', 'edit'), async (c) => {
    const parsed = paymentInput.safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success) fail(422, 'Please check the payment details.')
    const auth = c.get('auth')
    const ok = await withUser(c.env, auth.userId, async (sql) => {
      await sql`insert into received_payments ${sql({
        project_id: c.req.param('id')!,
        company_id: auth.companyId,
        amount: parsed.data.amount,
        paid_on: parsed.data.paid_on ?? new Date().toISOString().slice(0, 10),
        mode: parsed.data.mode ?? null,
        reference: parsed.data.reference ?? null,
        notes: parsed.data.notes ?? null,
        recorded_by: auth.userId,
      })}`
      return true
    }).catch(() => false)
    if (!ok) fail(400, 'We could not record the payment.')
    return c.body(null, 201)
  })
