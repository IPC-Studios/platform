import { Hono } from 'hono'
import {
  createProjectRequest,
  deliverableInput,
  deliverableSet,
  paymentInput,
  projectDetail,
  projectListItem,
  projectTrackingRow,
  saveDeliverableSetRequest,
  updateProjectRequest,
} from '@ipc/contracts'
import type { AppEnv } from '../../context'
import { requireAuth } from '../../middleware/auth'
import { requireAction } from '../../middleware/permissions'
import { fail } from '../../middleware/errors'
import { uuidParam } from '../../lib/params'
import { withUser } from '../../lib/db'
import { attempt } from '../../lib/attempt'
import { audit } from '../../lib/audit'

export const projectsRouter = new Hono<AppEnv>()
  .use('*', requireAuth)

  .get('/', requireAction('projects', 'view'), async (c) => {
    const rows = await attempt(c, 'projects.list', () =>
      withUser(
        c.env,
        c.get('auth').userId,
        // The money is rolled up here rather than fetched per row: the list
        // shows received and pending on every project, and doing that from the
        // client would be one request per project.
        (sql) => sql`
          select p.id, p.name, p.status, p.client_id, p.package_cost, p.total_cost, p.created_at,
                 cl.name as client_name, cl.phone as client_phone,
                 coalesce(
                   (select sum(rp.amount) from received_payments rp where rp.project_id = p.id),
                   0
                 ) as received
          from projects p
          left join clients cl on cl.id = p.client_id
          order by p.created_at desc`,
      ),
    )
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
    const rows = await attempt(c, 'projects.tracking', () =>
      withUser(
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
      ),
    )
    if (!rows) fail(400, 'We could not load project tracking.')
    return c.json(projectTrackingRow.array().parse(rows))
  })

  .post('/', requireAction('projects', 'create'), async (c) => {
    const parsed = createProjectRequest.safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success) fail(422, 'Please check the project details and try again.')
    const d = parsed.data
    const id = await attempt(c, 'projects.create', () =>
      withUser(c.env, c.get('auth').userId, async (sql) => {
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
      }),
    )
    if (!id) fail(400, 'We could not create this project.')
    await audit(c, {
      action: 'project.create',
      entityType: 'project',
      entityId: id,
      after: { name: d.name, client_id: d.client_id, package_cost: d.package_cost, status: d.status },
    })
    return c.json({ id }, 201)
  })

  // Declared above /:id so "deliverable-sets" is never read as a project id.
  .get('/deliverable-sets', requireAction('projects', 'view'), async (c) => {
    const rows = await attempt(c, 'projects.sets.list', () =>
      withUser(
        c.env,
        c.get('auth').userId,
        (sql) => sql`select id, name, items from deliverable_sets order by name asc`,
      ),
    )
    if (!rows) fail(400, 'We could not load your saved sets.')
    return c.json(deliverableSet.array().parse(rows))
  })

  .post('/deliverable-sets', requireAction('projects', 'edit'), async (c) => {
    const parsed = saveDeliverableSetRequest.safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success) fail(422, 'Please name the set and give it at least one item.')
    const auth = c.get('auth')
    const row = await attempt(c, 'projects.sets.save', () =>
      withUser(c.env, auth.userId, async (sql) => {
        // Saving under a name that exists replaces it — a studio revising
        // "Premium" means the package changed, not that there are two of them.
        const rows = await sql`
          insert into deliverable_sets ${sql({
            company_id: auth.companyId,
            name: parsed.data.name,
            items: sql.json(parsed.data.items),
          })}
          on conflict (company_id, name) do update set items = excluded.items
          returning id, name, items`
        return rows[0] ?? null
      }),
    )
    if (!row) fail(400, 'We could not save the set.')
    return c.json(deliverableSet.parse(row), 201)
  })

  .delete('/deliverable-sets/:id', requireAction('projects', 'edit'), async (c) => {
    const id = uuidParam(c)
    const rows = await attempt(c, 'projects.sets.delete', () =>
      withUser(c.env, c.get('auth').userId, (sql) => sql<{ id: string }[]>`
        delete from deliverable_sets where id = ${id} returning id`),
    )
    if (!rows) fail(400, 'We could not delete the set.')
    if (!rows.length) fail(404, 'That set was not found.')
    return c.body(null, 204)
  })

  .get('/:id', requireAction('projects', 'view'), async (c) => {
    const id = uuidParam(c)
    const row = await attempt(c, 'projects.get', () =>
      withUser(c.env, c.get('auth').userId, async (sql) => {
        const rows = await sql`
          select p.id, p.name, p.status, p.client_id, p.package_cost,
                 p.additional_deliverables_cost, p.total_cost, p.show_quotation, p.created_at,
                 cl.name as client_name, cl.phone as client_phone,
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
          left join clients cl on cl.id = p.client_id
          where p.id = ${id}`
        return rows[0] ?? null
      }),
    )
    if (!row) fail(404, 'That project was not found.')
    return c.json(projectDetail.parse(row))
  })

  .patch('/:id', requireAction('projects', 'edit'), async (c) => {
    const parsed = updateProjectRequest.safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success) fail(422, 'Please check the project details.')
    if (Object.keys(parsed.data).length === 0) return c.body(null, 204)
    const id = uuidParam(c)
    const rows = await attempt(c, 'projects.update', () =>
      withUser(
        c.env,
        c.get('auth').userId,
        (sql) => sql<{ id: string }[]>`update projects set ${sql(parsed.data)} where id = ${id} returning id`,
      ),
    )
    if (!rows) fail(400, 'We could not update the project.')
    if (!rows.length) fail(404, 'That project was not found.')
    await audit(c, { action: 'project.update', entityType: 'project', entityId: id, after: parsed.data })
    return c.body(null, 204)
  })

    /**
     * Delete a project outright — shoots, deliverables and tasks go with it.
     *
     * Refused once money has been recorded against it, and once a quotation
     * has gone to the client. Both are records of what the studio agreed to,
     * and a studio that wants either off the board wants the project
     * cancelled, not erased; the UI says so and offers that instead.
     */
  .delete('/:id', requireAction('projects', 'edit'), async (c) => {
    const id = uuidParam(c)
    const outcome = await attempt(c, 'projects.delete', () =>
      withUser(c.env, c.get('auth').userId, async (sql) => {
          const paid = await sql<{ n: number }[]>`
            select count(*)::int as n from received_payments where project_id = ${id}`
          if ((paid[0]?.n ?? 0) > 0) return 'has_payments' as const
          // Quotations are snapshots the client may already hold; deleting
          // the project would cascade-erase agreed evidence.
          const quoted = await sql<{ n: number }[]>`
            select count(*)::int as n from project_quotations where project_id = ${id}`
          if ((quoted[0]?.n ?? 0) > 0) return 'has_quotations' as const
          const rows = await sql<{ id: string }[]>`
            delete from projects where id = ${id} returning id`
          return rows.length ? ('deleted' as const) : ('missing' as const)
        }),
      )
      if (!outcome) fail(400, 'We could not delete this project.')
      if (outcome === 'has_payments') {
        fail(409, 'This project has payments recorded against it. Cancel it instead of deleting.')
      }
      if (outcome === 'has_quotations') {
        fail(409, 'This project has quotations the client has seen. Cancel it instead of deleting.')
      }
    if (outcome === 'missing') fail(404, 'That project was not found.')
    await audit(c, { action: 'project.delete', entityType: 'project', entityId: id })
    return c.body(null, 204)
  })

  // Add a deliverable to an existing project; the DB trigger recomputes totals.
  .post('/:id/deliverables', requireAction('projects', 'edit'), async (c) => {
    const parsed = deliverableInput.safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success) fail(422, 'Please check the deliverable details.')
    const auth = c.get('auth')
    const projectId = uuidParam(c)
    const row = await attempt(c, 'projects.deliverable_add', () =>
      withUser(c.env, auth.userId, async (sql) => {
        const rows = await sql<{ id: string }[]>`
          insert into deliverables ${sql({ ...parsed.data, project_id: projectId, company_id: auth.companyId })}
          returning id`
        return rows[0] ?? null
      }),
    )
    if (!row) fail(400, 'We could not add the deliverable.')
    await audit(c, { action: 'deliverable.add', entityType: 'project', entityId: projectId, after: parsed.data })
    return c.json({ id: row.id }, 201)
  })

  .delete('/:id/deliverables/:did', requireAction('projects', 'edit'), async (c) => {
    const projectId = uuidParam(c)
    const did = uuidParam(c, 'did')
    const rows = await attempt(c, 'projects.deliverable_delete', () =>
      withUser(
        c.env,
        c.get('auth').userId,
        (sql) => sql<{ id: string }[]>`
          delete from deliverables where id = ${did} and project_id = ${projectId} returning id`,
      ),
    )
    if (!rows) fail(400, 'We could not remove the deliverable.')
    if (!rows.length) fail(404, 'That deliverable was not found.')
    await audit(c, { action: 'deliverable.remove', entityType: 'project', entityId: projectId, before: { deliverable_id: did } })
    return c.body(null, 204)
  })

  // Record a payment against a project.
  .post('/:id/payments', requireAction('projects', 'edit'), async (c) => {
    const parsed = paymentInput.safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success) fail(422, 'Please check the payment details.')
    const auth = c.get('auth')
    const projectId = uuidParam(c)
    const row = await attempt(c, 'projects.payment_add', () =>
      withUser(c.env, auth.userId, async (sql) => {
        const rows = await sql<{ id: string }[]>`
          insert into received_payments ${sql({
            project_id: projectId,
            company_id: auth.companyId,
            amount: parsed.data.amount,
            paid_on: parsed.data.paid_on ?? new Date().toISOString().slice(0, 10),
            mode: parsed.data.mode ?? null,
            reference: parsed.data.reference ?? null,
            notes: parsed.data.notes ?? null,
            recorded_by: auth.userId,
          })}
          returning id`
        return rows[0] ?? null
      }),
    )
    if (!row) fail(400, 'We could not record the payment.')
    await audit(c, { action: 'project.payment', entityType: 'project', entityId: projectId, after: parsed.data })
    return c.json({ id: row.id }, 201)
  })
