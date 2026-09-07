import { Hono } from 'hono'
import {
  convertEnquiryRequest,
  convertEnquiryResponse,
  enquiryList,
  enquiryStatus,
  saveEnquiryRequest,
  z,
} from '@ipc/contracts'
import type { AppEnv } from '../../context'
import { requireAuth } from '../../middleware/auth'
import { requireModule, requireAction } from '../../middleware/permissions'
import { fail } from '../../middleware/errors'
import { uuidParam } from '../../lib/params'
import { withUser } from '../../lib/db'
import { attempt } from '../../lib/attempt'
import { audit } from '../../lib/audit'

const okResponse = z.object({ ok: z.boolean() })

/**
 * Enquiries — the raw inbox, before anything is worked.
 *
 * Gated on the CRM module: an enquiry is the front of the same funnel, and a
 * studio that cannot see leads has no use for the list they come from.
 */
export const enquiriesRouter = new Hono<AppEnv>()
  .use('*', requireAuth)

  /**
   * List and counts in one call. The summary is computed in SQL over the whole
   * table rather than from the filtered page — "3 new" has to mean three new,
   * not three on this screen.
   */
  .get('/', requireModule('crm'), async (c) => {
    const status = enquiryStatus.safeParse(c.req.query('status'))
    const search = (c.req.query('search') ?? '').trim()
    const rows = await attempt(c, 'enquiries.list', () =>
      withUser(c.env, c.get('auth').userId, async (sql) => {
        const items = await sql`
          select e.id, e.name, e.phone, e.email, e.message, e.source,
                 e.enquiry_status, e.assigned_to, u.name as assigned_to_name,
                 e.converted_lead_id, e.created_at
            from enquiries e
            left join users u on u.user_id = e.assigned_to
           where ${status.success ? sql`e.enquiry_status = ${status.data}` : sql`true`}
             and ${
               search
                 ? sql`(e.name ilike ${'%' + search + '%'}
                        or e.phone ilike ${'%' + search + '%'}
                        or e.email ilike ${'%' + search + '%'})`
                 : sql`true`
             }
           order by e.created_at desc
           limit 200`
        const summary = await sql`
          select count(*)::int as total_count,
                 count(*) filter (where enquiry_status in ('new','reviewed','contacted'))::int as open_count,
                 count(*) filter (where enquiry_status = 'new')::int as new_count,
                 count(*) filter (where enquiry_status = 'reviewed')::int as reviewed_count,
                 count(*) filter (where enquiry_status = 'contacted')::int as contacted_count,
                 count(*) filter (where enquiry_status = 'converted')::int as converted_count,
                 count(*) filter (where enquiry_status = 'closed')::int as closed_count
            from enquiries`
        return { items, summary: summary[0] }
      }),
    )
    if (!rows) fail(400, 'We could not load enquiries.')
    return c.json(enquiryList.parse(rows))
  })

  .post('/', requireAction('crm', 'edit'), async (c) => {
    const parsed = saveEnquiryRequest.safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success) fail(422, 'Please check the name and contact details.')
    const auth = c.get('auth')
    const d = parsed.data
    const rows = await attempt(c, 'enquiries.create', () =>
      withUser(c.env, auth.userId, async (sql) => {
        const made = await sql<{ id: string }[]>`
          insert into enquiries ${sql({
            company_id: auth.companyId,
            name: d.name,
            phone: d.phone ?? null,
            email: d.email ?? null,
            message: d.message ?? null,
            source: d.source ?? null,
            enquiry_status: d.enquiry_status,
            assigned_to: d.assigned_to ?? null,
            created_by: auth.userId,
          })}
          returning id`
        return made
      }),
    )
    if (!rows?.[0]) fail(400, 'We could not save this enquiry.')
    await audit(c, {
      action: 'enquiry.create',
      entityType: 'enquiry',
      entityId: rows[0].id,
      after: { name: d.name, source: d.source },
    })
    return c.json({ id: rows[0].id }, 201)
  })

  .patch('/:id', requireAction('crm', 'edit'), async (c) => {
    const id = uuidParam(c)
    const parsed = saveEnquiryRequest.safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success) fail(422, 'Please check the name and contact details.')
    const d = parsed.data
    const rows = await attempt(c, 'enquiries.update', () =>
      withUser(
        c.env,
        c.get('auth').userId,
        (sql) => sql<{ id: string }[]>`
          update enquiries
             set name = ${d.name}, phone = ${d.phone ?? null}, email = ${d.email ?? null},
                 message = ${d.message ?? null}, source = ${d.source ?? null},
                 enquiry_status = ${d.enquiry_status}, assigned_to = ${d.assigned_to ?? null}
           where id = ${id} returning id`,
      ),
    )
    if (!rows) fail(400, 'We could not save this enquiry.')
    if (!rows.length) fail(404, 'We could not find that enquiry.')
    await audit(c, { action: 'enquiry.update', entityType: 'enquiry', entityId: id, after: d })
    return c.json(okResponse.parse({ ok: true }))
  })

  .delete('/:id', requireAction('crm', 'edit'), async (c) => {
    const id = uuidParam(c)
    const rows = await attempt(c, 'enquiries.delete', () =>
      withUser(
        c.env,
        c.get('auth').userId,
        (sql) => sql<{ id: string }[]>`delete from enquiries where id = ${id} returning id`,
      ),
    )
    if (!rows) fail(400, 'We could not delete this enquiry.')
    if (!rows.length) fail(404, 'We could not find that enquiry.')
    await audit(c, { action: 'enquiry.delete', entityType: 'enquiry', entityId: id })
    return c.json(okResponse.parse({ ok: true }))
  })

  /**
   * Promote it to a lead. The function dedupes on the phone number, so an
   * enquiry from somebody already in the pipeline joins their existing lead
   * instead of forking their history.
   */
  .post('/:id/convert', requireAction('crm', 'edit'), async (c) => {
    const id = uuidParam(c)
    const parsed = convertEnquiryRequest.safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success) fail(422, 'Please check the note.')
    const rows = await attempt(c, 'enquiries.convert', () =>
      withUser(
        c.env,
        c.get('auth').userId,
        (sql) => sql<{ lead_id: string }[]>`
          select convert_enquiry_to_lead(
            p_enquiry_id => ${id},
            p_notes => ${parsed.data.notes ?? null}
          ) as lead_id`,
      ),
    )
    const leadId = rows?.[0]?.lead_id
    if (!leadId) fail(400, 'We could not convert this enquiry.')
    await audit(c, {
      action: 'enquiry.convert',
      entityType: 'enquiry',
      entityId: id,
      after: { lead_id: leadId },
    })
    return c.json(convertEnquiryResponse.parse({ lead_id: leadId }), 201)
  })
