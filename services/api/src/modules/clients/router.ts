import { Hono } from 'hono'
import { client, createClientRequest, updateClientRequest } from '@ipc/contracts'
import type { AppEnv } from '../../context'
import { requireAuth } from '../../middleware/auth'
import { requireAction } from '../../middleware/permissions'
import { fail } from '../../middleware/errors'
import { requestClient } from '../../lib/supabase'

export const clientsRouter = new Hono<AppEnv>()
  .use('*', requireAuth)

  .get('/', requireAction('clients', 'view'), async (c) => {
    const { data, error } = await requestClient(c)
      .from('clients')
      .select('*')
      .order('created_at', { ascending: false })
    if (error) fail(400, 'We could not load your clients.')
    return c.json(client.array().parse(data ?? []))
  })

  .post('/', requireAction('clients', 'create'), async (c) => {
    const parsed = createClientRequest.safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success) fail(422, 'Please check the client details and try again.')
    const { data, error } = await requestClient(c)
      .from('clients')
      .insert({ ...parsed.data, company_id: c.get('auth').companyId, created_by: c.get('auth').userId })
      .select('*')
      .single()
    if (error || !data) fail(400, 'We could not create this client.')
    return c.json(client.parse(data), 201)
  })

  .get('/:id', requireAction('clients', 'view'), async (c) => {
    const { data, error } = await requestClient(c)
      .from('clients')
      .select('*')
      .eq('id', c.req.param('id'))
      .single()
    if (error || !data) fail(404, 'That client was not found.')
    return c.json(client.parse(data))
  })

  .patch('/:id', requireAction('clients', 'edit'), async (c) => {
    const parsed = updateClientRequest.safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success) fail(422, 'Please check the client details and try again.')
    const { data, error } = await requestClient(c)
      .from('clients')
      .update(parsed.data)
      .eq('id', c.req.param('id'))
      .select('*')
      .single()
    if (error || !data) fail(400, 'We could not update this client.')
    return c.json(client.parse(data))
  })

  .delete('/:id', requireAction('clients', 'delete'), async (c) => {
    const { error } = await requestClient(c).from('clients').delete().eq('id', c.req.param('id'))
    if (error) fail(409, 'This client has linked projects and cannot be deleted.')
    return c.body(null, 204)
  })
