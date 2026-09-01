import { Hono } from 'hono'
import {
  createLeadRequest,
  createLeadSourceRequest,
  crmLead,
  distributionRule,
  leadSourceRow,
  updateLeadRequest,
  updateLeadSourceRequest,
} from '@ipc/contracts'
import type { AppEnv } from '../../context'
import { requireAuth } from '../../middleware/auth'
import { requireModule } from '../../middleware/permissions'
import { fail } from '../../middleware/errors'
import { withUser } from '../../lib/db'

const list = crmLead.array()

export const crmRouter = new Hono<AppEnv>()
  .use('*', requireAuth)
  .use('*', requireModule('crm'))

  .get('/leads', async (c) => {
    const rows = await withUser(
      c.env,
      c.get('auth').userId,
      (sql) => sql`
        select l.id, l.name, l.phone, l.email, l.source, l.status, l.assigned_to, l.notes,
               l.follow_up_at, l.last_contacted_at, l.converted_at, l.is_hot, l.created_at,
               u.name as assignee_name
        from crm_leads l
        left join users u on u.user_id = l.assigned_to
        order by l.created_at desc`,
    ).catch(() => null)
    if (!rows) fail(400, 'We could not load leads.')
    return c.json(list.parse(rows))
  })

  // Manual entry. add_lead carries the dedupe and round-robin the webhook path
  // uses, so a lead typed in by hand behaves like one that arrived by itself —
  // including handing back the existing row when the number is already known.
  .post('/leads', async (c) => {
    const parsed = createLeadRequest.safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success) fail(422, 'Please check the lead details.')
    const v = parsed.data

    const row = await withUser(c.env, c.get('auth').userId, async (sql) => {
      const [created] = await sql<{ id: string }[]>`
        select add_lead(
          ${v.name ?? null}, ${v.phone}, ${v.email ?? null},
          ${v.source}, ${v.notes ?? null}, ${v.assigned_to ?? null}
        ) as id`
      const id = created?.id
      if (!id) return null
      if (v.follow_up_at) {
        await sql`update crm_leads set follow_up_at = ${v.follow_up_at} where id = ${id}`
      }
      const [lead] = await sql`
        select l.id, l.name, l.phone, l.email, l.source, l.status, l.assigned_to, l.notes,
               l.follow_up_at, l.last_contacted_at, l.converted_at, l.is_hot, l.created_at,
               u.name as assignee_name
        from crm_leads l
        left join users u on u.user_id = l.assigned_to
        where l.id = ${id}`
      return lead ?? null
    }).catch(() => null)

    if (!row) fail(400, 'We could not add this lead.')
    return c.json(crmLead.parse(row), 201)
  })

  // Stage moves carry timestamps with them: leaving 'new' is the moment someone
  // was contacted, and reaching 'converted' is the moment it was won. Deriving
  // either from updated_at later would be a guess that a subsequent edit breaks.
  .patch('/leads/:id', async (c) => {
    const parsed = updateLeadRequest.safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success) fail(422, 'Invalid update.')
    if (Object.keys(parsed.data).length === 0) return c.body(null, 204)
    const patch = parsed.data
    const id = c.req.param('id')!

    const ok = await withUser(c.env, c.get('auth').userId, async (sql) => {
      const [current] = await sql<{ status: string; last_contacted_at: string | null }[]>`
        select status, last_contacted_at from crm_leads where id = ${id}`
      if (!current) return false

      const stamps: Record<string, string | null> = {}
      if (patch.status && patch.status !== 'new' && !current.last_contacted_at) {
        stamps.last_contacted_at = new Date().toISOString()
      }
      if (patch.status === 'converted') stamps.converted_at = new Date().toISOString()
      // Moving back out of 'converted' un-wins it, or the month's total counts
      // a sale that is no longer one.
      if (patch.status && patch.status !== 'converted' && current.status === 'converted') {
        stamps.converted_at = null
      }

      await sql`update crm_leads set ${sql({ ...patch, ...stamps })} where id = ${id}`
      return true
    }).catch(() => false)

    if (!ok) fail(400, 'We could not update the lead.')
    return c.body(null, 204)
  })

  // The rota new leads are shared out on, with what each person is carrying.
  .get('/distribution', async (c) => {
    const rows = await withUser(
      c.env,
      c.get('auth').userId,
      (sql) => sql`
        select r.id, r.user_id, r.priority, r.is_active, u.name as user_name,
               (
                 select count(*) from crm_leads l
                 where l.assigned_to = r.user_id and l.status not in ('converted', 'lost')
               )::int as lead_count
        from crm_distribution_rules r
        left join users u on u.user_id = r.user_id
        order by r.is_active desc, r.priority, u.name`,
    ).catch(() => null)
    if (!rows) fail(400, 'We could not load the distribution rota.')
    return c.json(distributionRule.array().parse(rows))
  })

  // ── Lead sources ────────────────────────────────────────────
  // Each row is an inbox: a key a web form or Meta posts to. The counts come
  // from the leads that actually arrived through it, which is the only way to
  // answer "is this campaign worth paying for".
  .get('/sources', async (c) => {
    const rows = await withUser(
      c.env,
      c.get('auth').userId,
      (sql) => sql`
        select s.id, s.label, s.source_key, s.kind, s.is_active, s.created_at,
               coalesce(l.total, 0)::int as lead_count,
               l.last_lead_at
        from crm_webhook_sources s
        left join lateral (
          select count(*) as total, max(created_at) as last_lead_at
          from crm_leads where source_key = s.source_key
        ) l on true
        order by s.is_active desc, s.created_at desc`,
    ).catch(() => null)
    if (!rows) fail(400, 'We could not load your lead sources.')
    return c.json(leadSourceRow.array().parse(rows))
  })

  .post('/sources', async (c) => {
    const parsed = createLeadSourceRequest.safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success) fail(422, 'Please name the source.')
    const { label, kind } = parsed.data

    // The key is generated in SQL and never accepted from the client — it is
    // the one credential that lets an unauthenticated caller write leads here.
    const row = await withUser(c.env, c.get('auth').userId, async (sql) => {
      const [created] = await sql`select * from create_lead_source(${label}, ${kind})`
      return created ?? null
    }).catch(() => null)
    if (!row) fail(400, 'We could not create this lead source.')

    return c.json(leadSourceRow.parse({ ...row, lead_count: 0, last_lead_at: null }), 201)
  })

  .patch('/sources/:id', async (c) => {
    const parsed = updateLeadSourceRequest.safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success) fail(422, 'Please check the details.')
    if (Object.keys(parsed.data).length === 0) return c.body(null, 204)

    const rows = await withUser(
      c.env,
      c.get('auth').userId,
      (sql) => sql<{ id: string }[]>`
        update crm_webhook_sources set ${sql(parsed.data)}
        where id = ${c.req.param('id')!} returning id`,
    ).catch(() => null)
    if (!rows) fail(400, 'We could not update this lead source.')
    if (!rows.length) fail(404, 'We could not find that lead source.')
    return c.body(null, 204)
  })

  // Deleting a source stops the key working. Leads it already brought in stay —
  // they belong to the studio, not to the form that delivered them.
  .delete('/sources/:id', async (c) => {
    const rows = await withUser(
      c.env,
      c.get('auth').userId,
      (sql) => sql<{ id: string }[]>`
        delete from crm_webhook_sources where id = ${c.req.param('id')!} returning id`,
    ).catch(() => null)
    if (!rows) fail(400, 'We could not delete this lead source.')
    if (!rows.length) fail(404, 'We could not find that lead source.')
    return c.body(null, 204)
  })
