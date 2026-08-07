import { Hono } from 'hono'
import {
  createProjectRequest,
  deliverableInput,
  paymentInput,
  projectDetail,
  projectListItem,
  updateProjectRequest,
} from '@ipc/contracts'
import type { AppEnv } from '../../context'
import { requireAuth } from '../../middleware/auth'
import { requireAction } from '../../middleware/permissions'
import { fail } from '../../middleware/errors'
import { requestClient } from '../../lib/supabase'

export const projectsRouter = new Hono<AppEnv>()
  .use('*', requireAuth)

  .get('/', requireAction('projects', 'view'), async (c) => {
    const { data, error } = await requestClient(c)
      .from('projects')
      .select('id,name,status,client_id,package_cost,total_cost,created_at,clients(name)')
      .order('created_at', { ascending: false })
    if (error) fail(400, 'We could not load your projects.')
    const rows = (data ?? []).map((r) => {
      const { clients, ...rest } = r as typeof r & { clients: { name: string } | null }
      return { ...rest, client_name: clients?.name ?? null }
    })
    return c.json(projectListItem.array().parse(rows))
  })

  .post('/', requireAction('projects', 'create'), async (c) => {
    const parsed = createProjectRequest.safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success) fail(422, 'Please check the project details and try again.')
    const { data, error } = await requestClient(c).rpc('create_project_with_details', {
      p_client_id: parsed.data.client_id,
      p_name: parsed.data.name,
      p_package_cost: parsed.data.package_cost,
      p_status: parsed.data.status,
      p_show_quotation: parsed.data.show_quotation,
      p_deliverables: parsed.data.deliverables,
      p_payments: parsed.data.payments,
    })
    if (error || !data) fail(400, 'We could not create this project.')
    return c.json({ id: data as string }, 201)
  })

  .get('/:id', requireAction('projects', 'view'), async (c) => {
    const { data, error } = await requestClient(c)
      .from('projects')
      .select(
        'id,name,status,client_id,package_cost,additional_deliverables_cost,total_cost,show_quotation,created_at,' +
          'deliverables(*),received_payments(id,amount,paid_on,mode,reference)',
      )
      .eq('id', c.req.param('id'))
      .single()
    if (error || !data) fail(404, 'That project was not found.')
    const row = data as unknown as Record<string, unknown> & { received_payments: unknown }
    return c.json(projectDetail.parse({ ...row, payments: row.received_payments }))
  })

  .patch('/:id', requireAction('projects', 'edit'), async (c) => {
    const parsed = updateProjectRequest.safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success) fail(422, 'Please check the project details.')
    const { error } = await requestClient(c)
      .from('projects')
      .update(parsed.data)
      .eq('id', c.req.param('id'))
    if (error) fail(400, 'We could not update the project.')
    return c.body(null, 204)
  })

  // Add a deliverable to an existing project; the DB trigger recomputes totals.
  .post('/:id/deliverables', requireAction('projects', 'edit'), async (c) => {
    const parsed = deliverableInput.safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success) fail(422, 'Please check the deliverable details.')
    const { error } = await requestClient(c)
      .from('deliverables')
      .insert({ ...parsed.data, project_id: c.req.param('id'), company_id: c.get('auth').companyId })
    if (error) fail(400, 'We could not add the deliverable.')
    return c.body(null, 201)
  })

  .delete('/:id/deliverables/:did', requireAction('projects', 'edit'), async (c) => {
    const { error } = await requestClient(c)
      .from('deliverables')
      .delete()
      .eq('id', c.req.param('did'))
      .eq('project_id', c.req.param('id'))
    if (error) fail(400, 'We could not remove the deliverable.')
    return c.body(null, 204)
  })

  // Record a payment against a project.
  .post('/:id/payments', requireAction('projects', 'edit'), async (c) => {
    const parsed = paymentInput.safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success) fail(422, 'Please check the payment details.')
    const { error } = await requestClient(c).from('received_payments').insert({
      project_id: c.req.param('id'),
      company_id: c.get('auth').companyId,
      amount: parsed.data.amount,
      paid_on: parsed.data.paid_on ?? new Date().toISOString().slice(0, 10),
      mode: parsed.data.mode ?? null,
      reference: parsed.data.reference ?? null,
      notes: parsed.data.notes ?? null,
      recorded_by: c.get('auth').userId,
    })
    if (error) fail(400, 'We could not record the payment.')
    return c.body(null, 201)
  })
