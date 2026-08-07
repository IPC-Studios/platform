import { Hono } from 'hono'
import { createShootRequest, shootListItem, updateShootRequest } from '@ipc/contracts'
import type { AppEnv } from '../../context'
import { requireAuth } from '../../middleware/auth'
import { requireAction } from '../../middleware/permissions'
import { fail } from '../../middleware/errors'
import { requestClient } from '../../lib/supabase'

interface RawShoot {
  id: string
  name: string
  project_id: string
  shoot_date: string | null
  location: string | null
  status: string
  projects: { name: string } | null
}

const list = shootListItem.array()
const SELECT = 'id,name,project_id,shoot_date,location,status,projects(name)'

export const shootsRouter = new Hono<AppEnv>()
  .use('*', requireAuth)

  .get('/', requireAction('projects', 'view'), async (c) => {
    let q = requestClient(c).from('shoots').select(SELECT)
    const project = c.req.query('project_id')
    if (project) q = q.eq('project_id', project)
    const { data, error } = await q.order('shoot_date', { ascending: true, nullsFirst: false })
    if (error) fail(400, 'We could not load shoots.')
    const rows = ((data ?? []) as unknown as RawShoot[]).map((r) => ({
      ...r,
      project_name: r.projects?.name ?? null,
    }))
    return c.json(list.parse(rows))
  })

  .post('/', requireAction('projects', 'edit'), async (c) => {
    const parsed = createShootRequest.safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success) fail(422, 'Please check the shoot details.')
    const { data, error } = await requestClient(c)
      .from('shoots')
      .insert({ ...parsed.data, company_id: c.get('auth').companyId })
      .select('id')
      .single()
    if (error || !data) fail(400, 'We could not create the shoot.')
    return c.json({ id: (data as { id: string }).id }, 201)
  })

  .patch('/:id', requireAction('projects', 'edit'), async (c) => {
    const parsed = updateShootRequest.safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success) fail(422, 'Please check the shoot details.')
    const { error } = await requestClient(c)
      .from('shoots')
      .update(parsed.data)
      .eq('id', c.req.param('id'))
    if (error) fail(400, 'We could not update the shoot.')
    return c.body(null, 204)
  })
