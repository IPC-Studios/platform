import { Hono } from 'hono'
import { crmLead, updateLeadRequest } from '@ipc/contracts'
import type { AppEnv } from '../../context'
import { requireAuth } from '../../middleware/auth'
import { requireModule } from '../../middleware/permissions'
import { fail } from '../../middleware/errors'
import { requestClient } from '../../lib/supabase'

interface RawLead {
  id: string
  name: string | null
  phone: string | null
  email: string | null
  source: string
  status: string
  assigned_to: string | null
  created_at: string
  users: { name: string } | null
}

const list = crmLead.array()
const SELECT = 'id,name,phone,email,source,status,assigned_to,created_at,users:assigned_to(name)'

export const crmRouter = new Hono<AppEnv>()
  .use('*', requireAuth)
  .use('*', requireModule('crm'))

  .get('/leads', async (c) => {
    const { data, error } = await requestClient(c)
      .from('crm_leads')
      .select(SELECT)
      .order('created_at', { ascending: false })
    if (error) fail(400, 'We could not load leads.')
    const rows = ((data ?? []) as unknown as RawLead[]).map((r) => ({
      ...r,
      assignee_name: r.users?.name ?? null,
    }))
    return c.json(list.parse(rows))
  })

  .patch('/leads/:id', async (c) => {
    const parsed = updateLeadRequest.safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success) fail(422, 'Invalid update.')
    const { error } = await requestClient(c)
      .from('crm_leads')
      .update(parsed.data)
      .eq('id', c.req.param('id'))
    if (error) fail(400, 'We could not update the lead.')
    return c.body(null, 204)
  })
