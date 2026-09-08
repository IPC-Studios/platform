import { Hono } from 'hono'
import {
  createTeamPayoutRequest,
  teamPayout,
  teamPayoutList,
  z,
} from '@ipc/contracts'
import type { AppEnv } from '../../context'
import { requireAuth } from '../../middleware/auth'
import { requireModule } from '../../middleware/permissions'
import { fail } from '../../middleware/errors'
import { uuidParam } from '../../lib/params'
import { withUser } from '../../lib/db'
import { attempt } from '../../lib/attempt'
import { audit } from '../../lib/audit'

const okResponse = z.object({ ok: z.boolean() })

/**
 * Team payouts — settlement management for team members.
 * Admin only (owner or super_admin).
 */
export const teamPayoutsRouter = new Hono<AppEnv>()
  .use('*', requireAuth)
  .use('*', requireModule('team_payouts'))

  .get('/', async (c) => {
    const userId = c.req.query('user_id')
    const status = c.req.query('status')
    const rows = await attempt(c, 'team-payouts.list', () =>
      withUser(c.env, c.get('auth').userId, async (sql) => {
        const items = await sql`
          select tp.id, tp.company_id, tp.user_id, u.name as user_name,
                 tp.amount, tp.period_start, tp.period_end, tp.status,
                 tp.payment_mode, tp.reference, tp.notes, tp.created_at
            from team_payouts tp
            left join users u on u.user_id = tp.user_id
           where tp.company_id = ${c.get('auth').companyId}
             and ${userId ? sql`tp.user_id = ${userId}` : sql`true`}
             and ${status ? sql`tp.status = ${status}` : sql`true`}
           order by tp.created_at desc`
        const summary = await sql`
          select count(*)::int as total_payouts,
                 coalesce(sum(amount), 0)::numeric as total_amount,
                 coalesce(sum(amount) filter (where status = 'pending'), 0)::numeric as pending_amount,
                 coalesce(sum(amount) filter (where status = 'completed'), 0)::numeric as completed_amount,
                 coalesce(sum(amount) filter (where period_start >= date_trunc('month', current_date)), 0)::numeric as this_month_amount
            from team_payouts
           where company_id = ${c.get('auth').companyId}`
        return { items, summary: summary[0] }
      }),
    )
    if (!rows) fail(400, 'We could not load payouts.')
    return c.json(teamPayoutList.parse(rows))
  })

  .post('/', async (c) => {
    const parsed = createTeamPayoutRequest.safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success) fail(422, 'Please check the payout details.')
    const auth = c.get('auth')
    const d = parsed.data
    const rows = await attempt(c, 'team-payouts.create', () =>
      withUser(c.env, auth.userId, async (sql) => {
        const result = await sql<{ create_team_payout: string }[]>`
          select create_team_payout(
            p_user_id => ${d.user_id}::uuid,
            p_amount => ${d.amount}::numeric,
            p_period_start => ${d.period_start}::date,
            p_period_end => ${d.period_end}::date,
            p_payment_mode => ${d.payment_mode ?? null},
            p_reference => ${d.reference ?? null},
            p_notes => ${d.notes ?? null}
          ) as create_team_payout`
        return result
      }),
    )
    if (!rows?.[0]) fail(400, 'We could not create this payout.')
    await audit(c, { action: 'team_payout.create', entityType: 'team_payout', entityId: rows[0].create_team_payout, after: d })
    return c.json({ id: rows[0].create_team_payout }, 201)
  })

  .patch('/:id/status', async (c) => {
    const id = uuidParam(c)
    const body = await c.req.json().catch(() => ({}))
    const status = z.enum(['pending', 'processing', 'completed', 'failed']).safeParse(body.status)
    if (!status.success) fail(422, 'Invalid status.')
    const auth = c.get('auth')
    const rows = await attempt(c, 'team-payouts.status', () =>
      withUser(c.env, auth.userId, async (sql) => {
        return sql<{ id: string }[]>`
          update team_payouts
             set status = ${status.data}
           where id = ${id} and company_id = ${auth.companyId}
           returning id`
      }),
    )
    if (!rows) fail(400, 'We could not update this payout.')
    if (!rows.length) fail(404, 'We could not find that payout.')
    await audit(c, { action: 'team_payout.status', entityType: 'team_payout', entityId: id, after: { status: status.data } })
    return c.json(okResponse.parse({ ok: true }))
  })

  .delete('/:id', async (c) => {
    const id = uuidParam(c)
    const auth = c.get('auth')
    const rows = await attempt(c, 'team-payouts.delete', () =>
      withUser(c.env, auth.userId, async (sql) => {
        return sql<{ id: string }[]>`
          delete from team_payouts where id = ${id} and company_id = ${auth.companyId} returning id`
      }),
    )
    if (!rows) fail(400, 'We could not delete this payout.')
    if (!rows.length) fail(404, 'We could not find that payout.')
    await audit(c, { action: 'team_payout.delete', entityType: 'team_payout', entityId: id })
    return c.json(okResponse.parse({ ok: true }))
  })
