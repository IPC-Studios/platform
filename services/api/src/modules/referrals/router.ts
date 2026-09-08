import { Hono } from 'hono'
import {
  createReferralCampaignRequest,
  referralCampaignList,
  referralSubmissionList,
  submitReferralRequest,
  z,
} from '@ipc/contracts'
import type { AppEnv } from '../../context'
import { requireAuth } from '../../middleware/auth'
import { requireModule, requireAction } from '../../middleware/permissions'
import { fail } from '../../middleware/errors'
import { uuidParam } from '../../lib/params'
import { withUser, withService } from '../../lib/db'
import { attempt } from '../../lib/attempt'
import { audit } from '../../lib/audit'

const okResponse = z.object({ ok: z.boolean() })

/**
 * Referral system — campaigns and submissions.
 * Admin/manager can manage campaigns; submissions are tracked automatically.
 */
export const referralsRouter = new Hono<AppEnv>()
  .use('*', requireAuth)

  // ── Campaigns ──────────────────────────────────────────────
  .get('/campaigns', requireModule('referrals'), async (c) => {
    const rows = await attempt(c, 'referrals.campaigns', () =>
      withUser(c.env, c.get('auth').userId, async (sql) => {
        const campaigns = await sql`
          select id, company_id, name, description, reward_type, reward_value,
                 reward_description, status, created_at
            from referral_campaigns
           where company_id = ${c.get('auth').companyId}
           order by created_at desc`
        const summary = await sql`
          select count(*)::int as total_campaigns,
                 count(*) filter (where status = 'active')::int as active_campaigns,
                 (select count(*)::int from referral_submissions where company_id = ${c.get('auth').companyId}) as total_submissions,
                 (select count(*)::int from referral_submissions where company_id = ${c.get('auth').companyId} and status = 'converted') as converted_submissions,
                 (select coalesce(sum(reward_amount), 0) from referral_submissions where company_id = ${c.get('auth').companyId} and reward_granted = true) as total_rewards`
        return { campaigns, summary: summary[0] }
      }),
    )
    if (!rows) fail(400, 'We could not load referrals.')
    return c.json(referralCampaignList.parse(rows))
  })

  .post('/campaigns', requireAction('referrals', 'edit'), async (c) => {
    const parsed = createReferralCampaignRequest.safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success) fail(422, 'Please check the campaign details.')
    const auth = c.get('auth')
    const d = parsed.data
    const rows = await attempt(c, 'referrals.campaign_create', () =>
      withUser(c.env, auth.userId, async (sql) => {
        const made = await sql<{ id: string }[]>`
          insert into referral_campaigns (company_id, name, description, reward_type, reward_value, reward_description, created_by)
          values (${auth.companyId}, ${d.name}, ${d.description ?? null}, ${d.reward_type}, ${d.reward_value}, ${d.reward_description ?? null}, ${auth.userId})
          returning id`
        return made
      }),
    )
    if (!rows?.[0]) fail(400, 'We could not create this campaign.')
    await audit(c, { action: 'referral_campaign.create', entityType: 'referral_campaign', entityId: rows[0].id, after: d })
    return c.json({ id: rows[0].id }, 201)
  })

  .patch('/:id', requireAction('referrals', 'edit'), async (c) => {
    const id = uuidParam(c)
    const parsed = createReferralCampaignRequest.safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success) fail(422, 'Please check the campaign details.')
    const auth = c.get('auth')
    const d = parsed.data
    const rows = await attempt(c, 'referrals.campaign_update', () =>
      withUser(c.env, auth.userId, async (sql) => {
        return sql<{ id: string }[]>`
          update referral_campaigns
             set name = ${d.name}, description = ${d.description ?? null},
                 reward_type = ${d.reward_type}, reward_value = ${d.reward_value},
                 reward_description = ${d.reward_description ?? null}
           where id = ${id} and company_id = ${auth.companyId}
           returning id`
      }),
    )
    if (!rows) fail(400, 'We could not save this campaign.')
    if (!rows.length) fail(404, 'We could not find that campaign.')
    await audit(c, { action: 'referral_campaign.update', entityType: 'referral_campaign', entityId: id, after: d })
    return c.json(okResponse.parse({ ok: true }))
  })

  .delete('/:id', requireAction('referrals', 'edit'), async (c) => {
    const id = uuidParam(c)
    const auth = c.get('auth')
    const rows = await attempt(c, 'referrals.campaign_delete', () =>
      withUser(c.env, auth.userId, async (sql) => {
        return sql<{ id: string }[]>`
          delete from referral_campaigns where id = ${id} and company_id = ${auth.companyId} returning id`
      }),
    )
    if (!rows) fail(400, 'We could not delete this campaign.')
    if (!rows.length) fail(404, 'We could not find that campaign.')
    await audit(c, { action: 'referral_campaign.delete', entityType: 'referral_campaign', entityId: id })
    return c.json(okResponse.parse({ ok: true }))
  })

  // ── Submissions ────────────────────────────────────────────
  .get('/submissions', requireModule('referrals'), async (c) => {
    const rawCampaignId = c.req.query('campaign_id')
    if (rawCampaignId != null && rawCampaignId !== '') {
      const uc = z.string().uuid().safeParse(rawCampaignId)
      if (!uc.success) fail(422, 'Invalid campaign ID.')
    }
    const campaignId: string | null = rawCampaignId || null
    const rawCursor = c.req.query('cursor') || null
    const cursor: string | null = rawCursor
    if (cursor && Number.isNaN(Date.parse(cursor))) fail(422, 'Invalid cursor.')
    const limitRaw = Number(c.req.query('limit') ?? 100)
    const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(Math.trunc(limitRaw), 1), 200) : 100

    const rows = await attempt(c, 'referrals.submissions', () =>
      withUser(c.env, c.get('auth').userId, async (sql) => {
        return sql`
          select rs.id, rs.campaign_id, rc.name as campaign_name,
                 rs.referrer_name, rs.referrer_phone,
                 rs.client_name, rs.client_phone, rs.client_email,
                 rs.status, rs.reward_granted, rs.reward_amount, rs.notes,
                 rs.created_at
            from referral_submissions rs
            join referral_campaigns rc on rc.id = rs.campaign_id
           where rs.company_id = ${c.get('auth').companyId}
             and (${campaignId}::uuid is null or rs.campaign_id = ${campaignId}::uuid)
             and (${cursor}::timestamptz is null or rs.created_at < ${cursor}::timestamptz)
           order by rs.created_at desc
           limit ${limit + 1}`
      }),
    )
    if (!rows) fail(400, 'We could not load submissions.')
    const items = rows.slice(0, limit)
    const last = items[items.length - 1] as { created_at?: string } | undefined
    return c.json(
      referralSubmissionList.parse({
        items,
        next_cursor: items.length < rows.length && last?.created_at ? last.created_at : null,
      }),
    )
  })

  .patch('/submissions/:id/status', requireAction('referrals', 'edit'), async (c) => {
    const id = uuidParam(c)
    const body = await c.req.json().catch(() => ({}))
    const status = z.enum(['pending', 'converted', 'rewarded', 'rejected']).safeParse(body.status)
    if (!status.success) fail(422, 'Invalid status.')
    const auth = c.get('auth')
    const rows = await attempt(c, 'referrals.submission_status', () =>
      withUser(c.env, auth.userId, async (sql) => {
        return sql<{ id: string }[]>`
          update referral_submissions
             set status = ${status.data},
                 reward_granted = ${status.data === 'rewarded'},
                 reward_amount = case when ${status.data} = 'rewarded' then reward_amount else reward_amount end
           where id = ${id} and company_id = ${auth.companyId}
           returning id`
      }),
    )
    if (!rows) fail(400, 'We could not update this submission.')
    if (!rows.length) fail(404, 'We could not find that submission.')
    await audit(c, { action: 'referral_submission.status', entityType: 'referral_submission', entityId: id, after: { status: status.data } })
    return c.json(okResponse.parse({ ok: true }))
  })

// ── Public route (no auth) ─────────────────────────────────
const publicReferralsRouter = new Hono<AppEnv>()

publicReferralsRouter.post('/referrals/submit', async (c) => {
  const parsed = submitReferralRequest.safeParse(await c.req.json().catch(() => ({})))
  if (!parsed.success) fail(422, 'Please check the referral details.')
  const campaignId = c.req.query('campaign_id')
  if (!campaignId) fail(422, 'Campaign ID is required.')
  const uc = z.string().uuid().safeParse(campaignId)
  if (!uc.success) fail(422, 'Invalid campaign ID.')
  const d = parsed.data

  let rows: { submit_referral: string }[] | null = null
  try {
    rows = await withService(c.env, async (sql) => {
      const result = await sql<{ submit_referral: string }[]>`
        select submit_referral(
          p_campaign_id => ${campaignId}::uuid,
          p_referrer_name => ${d.referrer_name ?? null},
          p_referrer_phone => ${d.referrer_phone ?? null},
          p_client_name => ${d.client_name},
          p_client_phone => ${d.client_phone ?? null},
          p_client_email => ${d.client_email ?? null},
          p_notes => ${d.notes ?? null}
        ) as submit_referral`
      return result
    })
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e)
    if (msg.includes('campaign not found') || msg.includes('not found')) fail(404, 'Campaign not found.')
    if (msg.includes('duplicate') || msg.includes('already exists')) fail(409, 'Duplicate referral.')
    throw e
  }

  if (!rows?.[0]) fail(400, 'We could not submit this referral.')
  return c.json({ id: rows[0].submit_referral }, 201)
})

export { publicReferralsRouter }
