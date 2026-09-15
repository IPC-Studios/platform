import { Hono } from 'hono'
import {
  createPersonalExpenseRequest,
  personalExpenseList,
  personalExpenseReport,
  personalExpenseReportRequest,
  z,
} from '@ipc/contracts'
import type { AppEnv } from '../../context'
import { requireAuth } from '../../middleware/auth'
import { requireModule } from '../../middleware/permissions'
import { fail } from '../../middleware/errors'
import { numberQuery, uuidParam } from '../../lib/params'
import { withUser } from '../../lib/db'
import { attempt } from '../../lib/attempt'
import { rpcJson } from '../../lib/rpc'
import { audit } from '../../lib/audit'

const okResponse = z.object({ ok: z.boolean() })

/**
 * Personal expenses — each user sees and manages only their own records.
 * The module is visible to all roles by default.
 */
export const personalExpensesRouter = new Hono<AppEnv>()
  .use('*', requireAuth)

  .get('/', requireModule('personal_expenses'), async (c) => {
    const search = c.req.query('search') ?? null
    const category = c.req.query('category') ?? null
    // Lovable parity: search/category/party/date_from/date_to/min/max/gst/reverse/has_invoice.
    const dateFrom = c.req.query('date_from') ?? null
    const dateTo = c.req.query('date_to') ?? null
    const minAmount = numberQuery(c, 'min_amount', 'amount_min')
    const maxAmount = numberQuery(c, 'max_amount', 'amount_max')
    const hasInvoice = c.req.query('has_invoice') ?? null
    const partyId = c.req.query('party_id') ?? null
    const gstTreatment = c.req.query('gst_treatment') ?? null
    const reverseRaw = c.req.query('reverse_charge') ?? null
    const reverseCharge = reverseRaw == null || reverseRaw === '' ? null : reverseRaw === 'true' ? true : reverseRaw === 'false' ? false : null
    const cursor = c.req.query('cursor')
    if (cursor && Number.isNaN(Date.parse(cursor))) fail(422, 'Invalid cursor.')
    const limitRaw = Number(c.req.query('limit') ?? 100)
    const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(Math.trunc(limitRaw), 1), 200) : 100

    const rows = await attempt(c, 'personal-expenses.list', () =>
      withUser(c.env, c.get('auth').userId, async (sql) => {
        // Try parity-filtered direct read first (post-0120 columns); fall back
        // to the legacy RPC when columns are missing.
        try {
          const direct = await sql<Record<string, unknown>[]>`select pe.id, pe.company_id, pe.user_id, pe.party_id,
              (select name from parties where id = pe.party_id) as party_name,
              pe.amount, pe.expense_date::text as expense_date, pe.category, pe.gst_treatment, pe.gst_rate,
              pe.description, pe.created_at::text as created_at,
              pe.invoice_number, pe.amount_is, pe.tax_name, pe.tax_amount, pe.reverse_charge, pe.itemize_json
            from personal_expense pe
           where pe.company_id = ${c.get('auth').companyId} and pe.user_id = ${c.get('auth').userId}
              and (${search}::text is null or pe.description ilike '%' || ${search} || '%' or pe.invoice_number ilike '%' || ${search} || '%')
              and (${category}::text is null or pe.category = ${category})
              and (${partyId}::uuid is null or pe.party_id = ${partyId}::uuid)
              and (${gstTreatment}::text is null or pe.gst_treatment = ${gstTreatment})
              and (${reverseCharge}::boolean is null or pe.reverse_charge is not distinct from ${reverseCharge}::boolean)
              and (${dateFrom}::date is null or pe.expense_date >= ${dateFrom}::date)
              and (${dateTo}::date is null or pe.expense_date <= ${dateTo}::date)
              and (${minAmount}::numeric is null or pe.amount >= ${minAmount}::numeric)
              and (${maxAmount}::numeric is null or pe.amount <= ${maxAmount}::numeric)
              and (${hasInvoice}::text is null or (${hasInvoice} = 'true' and pe.invoice_number is not null) or (${hasInvoice} = 'false'))
             and (${cursor ? cursor : null}::timestamptz is null or pe.created_at < ${cursor ? cursor : null}::timestamptz)
           order by pe.created_at desc limit ${limit + 1}`
          const items: Record<string, unknown>[] = direct.slice(0, limit).map((r) => ({
            ...r, itemize_json: Array.isArray(r['itemize_json']) ? r['itemize_json'] : null,
          }))
          const total = items.reduce((s, r) => s + Number(r['amount'] ?? 0), 0)
          const last = items[items.length - 1] as Record<string, unknown> | undefined
          return {
            items,
            summary: { total_count: items.length, total_amount: total, this_month_amount: total, this_month_count: items.length },
            next_cursor: direct.length > limit && last?.['created_at'] ? last['created_at'] : null,
          }
        } catch {
          const result = await sql<{ list_personal_expenses: unknown }[]>`
            select list_personal_expenses(
              p_search => ${search},
              p_category => ${category},
              p_cursor => ${cursor ? cursor : null}::timestamptz,
              p_limit => ${limit}
            ) as list_personal_expenses`
          return rpcJson(result[0]?.list_personal_expenses, {})
        }
      }),
    )
    if (!rows) fail(400, 'We could not load your expenses.')
    return c.json(personalExpenseList.parse(rows))
  })

  .get('/report', requireModule('personal_expenses'), async (c) => {
    const parsed = personalExpenseReportRequest.safeParse({
      start_date: c.req.query('start_date'),
      end_date: c.req.query('end_date'),
    })
    if (!parsed.success) fail(422, 'Please provide valid start and end dates.')

    const rows = await attempt(c, 'personal-expenses.report', () =>
      withUser(c.env, c.get('auth').userId, async (sql) => {
        const result = await sql<{ personal_expense_report: unknown }[]>`
          select personal_expense_report(
            p_start_date => ${parsed.data.start_date}::date,
            p_end_date => ${parsed.data.end_date}::date
          ) as personal_expense_report`
        return rpcJson(result[0]?.personal_expense_report, {})
      }),
    )
    if (!rows) fail(400, 'We could not generate the report.')
    return c.json(personalExpenseReport.parse(rows))
  })

  .post('/', requireModule('personal_expenses'), async (c) => {
    const parsed = createPersonalExpenseRequest.safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success) fail(422, 'Please check the expense details.')
    const auth = c.get('auth')
    const d = parsed.data
    const rows = await attempt(c, 'personal-expenses.create', () =>
      withUser(c.env, auth.userId, async (sql) => {
        // Parity columns are best-effort (pre-0120 benches lack them).
        try {
          const made = await sql<{ id: string }[]>`
            insert into personal_expense (company_id, user_id, party_id, amount, expense_date, category, gst_treatment, gst_rate, description,
              invoice_number, amount_is, tax_name, tax_amount, reverse_charge, itemize_json)
            values (${auth.companyId}, ${auth.userId}, ${d.party_id ?? null}, ${d.amount},
                    ${d.expense_date ?? new Date().toISOString().slice(0, 10)}::date,
                    ${d.category ?? null}, ${d.gst_treatment}, ${d.gst_rate ?? null}, ${d.description ?? null},
                    ${d.invoice_number ?? null}, ${d.amount_is ?? null}, ${d.tax_name ?? null},
                    ${d.tax_amount ?? null}, ${d.reverse_charge ?? null},
                    ${d.itemize_json ? sql.json(d.itemize_json as never) : null}::jsonb)
            returning id`
          return made
        } catch {
          const made = await sql<{ id: string }[]>`
            insert into personal_expense (company_id, user_id, party_id, amount, expense_date, category, gst_treatment, gst_rate, description)
            values (${auth.companyId}, ${auth.userId}, ${d.party_id ?? null}, ${d.amount},
                    ${d.expense_date ?? new Date().toISOString().slice(0, 10)}::date,
                    ${d.category ?? null}, ${d.gst_treatment}, ${d.gst_rate ?? null}, ${d.description ?? null})
            returning id`
          return made
        }
      }),
    )
    if (!rows?.[0]) fail(400, 'We could not save this expense.')
    await audit(c, {
      action: 'personal_expense.create',
      entityType: 'personal_expense',
      entityId: rows[0].id,
      after: { amount: d.amount, category: d.category },
    })
    return c.json({ id: rows[0].id }, 201)
  })

  .patch('/:id', requireModule('personal_expenses'), async (c) => {
    const id = uuidParam(c)
    const raw = await c.req.json().catch(() => ({}))
    // Allow partial updates: only fields present in the body are changed
    const partialSchema = createPersonalExpenseRequest.partial()
    const parsed = partialSchema.safeParse(raw)
    if (!parsed.success) fail(422, 'Please check the expense details.')
    if (Object.keys(parsed.data).length === 0) fail(422, 'No fields to update.')
    const auth = c.get('auth')
    const d = parsed.data
    const rows = await attempt(c, 'personal-expenses.update', () =>
      withUser(c.env, auth.userId, async (sql) => {
        // Parity columns best-effort: fall back to legacy columns on old benches.
        try {
          const itemize = 'itemize_json' in d
            ? d.itemize_json == null ? null : sql.json(d.itemize_json as never)
            : undefined
          return await sql<{ id: string }[]>`
            update personal_expense
               set party_id = coalesce(${d.party_id ?? null}::uuid, party_id),
                   amount = coalesce(${d.amount ?? null}::numeric, amount),
                   expense_date = coalesce(${d.expense_date ?? null}::date, expense_date),
                   category = coalesce(${d.category ?? null}, category),
                   gst_treatment = coalesce(${d.gst_treatment ?? null}, gst_treatment),
                   gst_rate = coalesce(${d.gst_rate ?? null}::numeric, gst_rate),
                   description = coalesce(${d.description ?? null}, description),
                   invoice_number = case when ${'invoice_number' in d} then ${d.invoice_number ?? null} else invoice_number end,
                   amount_is = case when ${'amount_is' in d} then ${d.amount_is ?? null} else amount_is end,
                   tax_name = case when ${'tax_name' in d} then ${d.tax_name ?? null} else tax_name end,
                   tax_amount = case when ${'tax_amount' in d} then ${d.tax_amount ?? null}::numeric else tax_amount end,
                   reverse_charge = case when ${'reverse_charge' in d} then ${d.reverse_charge ?? null}::boolean else reverse_charge end
             where id = ${id} and company_id = ${auth.companyId} and user_id = ${auth.userId}
             returning id`
            .then(async (r) => {
              if ('itemize_json' in d && r.length) {
                try {
                  await sql`update personal_expense set itemize_json = ${itemize as never}::jsonb
                    where id = ${id} and company_id = ${auth.companyId} and user_id = ${auth.userId}`
                } catch { /* old bench without column */ }
              }
              return r
            })
        } catch {
          return sql<{ id: string }[]>`
            update personal_expense
               set party_id = coalesce(${d.party_id ?? null}::uuid, party_id),
                   amount = coalesce(${d.amount ?? null}::numeric, amount),
                   expense_date = coalesce(${d.expense_date ?? null}::date, expense_date),
                   category = coalesce(${d.category ?? null}, category),
                   gst_treatment = coalesce(${d.gst_treatment ?? null}, gst_treatment),
                   gst_rate = coalesce(${d.gst_rate ?? null}::numeric, gst_rate),
                   description = coalesce(${d.description ?? null}, description)
             where id = ${id} and company_id = ${auth.companyId} and user_id = ${auth.userId}
             returning id`
        }
      }),
    )
    if (!rows) fail(400, 'We could not save this expense.')
    if (!rows.length) fail(404, 'We could not find that expense.')
    await audit(c, { action: 'personal_expense.update', entityType: 'personal_expense', entityId: id, after: d })
    return c.json(okResponse.parse({ ok: true }))
  })

  .delete('/:id', requireModule('personal_expenses'), async (c) => {
    const id = uuidParam(c)
    const auth = c.get('auth')
    const rows = await attempt(c, 'personal-expenses.delete', () =>
      withUser(c.env, auth.userId, async (sql) => {
        return sql<{ id: string }[]>`
          delete from personal_expense
           where id = ${id} and company_id = ${auth.companyId} and user_id = ${auth.userId}
           returning id`
      }),
    )
    if (!rows) fail(400, 'We could not delete this expense.')
    if (!rows.length) fail(404, 'We could not find that expense.')
    await audit(c, { action: 'personal_expense.delete', entityType: 'personal_expense', entityId: id })
    return c.json(okResponse.parse({ ok: true }))
  })

  // Lovable parity: detail (full summary row) + attachments CRUD.
  .get('/:id', requireModule('personal_expenses'), async (c) => {
    const id = uuidParam(c)
    const auth = c.get('auth')
    const row = await attempt(c, 'personal-expenses.detail', () =>
      withUser(c.env, auth.userId, async (sql) => {
        try {
          const rows = await sql<Record<string, unknown>[]>`select pe.id, pe.company_id, pe.user_id, pe.party_id,
              (select name from parties where id = pe.party_id) as party_name,
              pe.amount, pe.expense_date::text as expense_date, pe.category, pe.gst_treatment, pe.gst_rate,
              pe.description, pe.created_at::text as created_at,
              pe.invoice_number, pe.amount_is, pe.tax_name, pe.tax_amount, pe.reverse_charge, pe.itemize_json
            from personal_expense pe
           where pe.id = ${id} and pe.company_id = ${auth.companyId} and pe.user_id = ${auth.userId}`
          return rows[0] ?? null
        } catch {
          return null
        }
      }),
    )
    if (!row) fail(404, 'We could not find that expense.')
    return c.json({ ...(row as Record<string, unknown>), itemize_json: Array.isArray((row as Record<string, unknown>)['itemize_json']) ? (row as Record<string, unknown>)['itemize_json'] : null })
  })

  .get('/:id/attachments', requireModule('personal_expenses'), async (c) => {
    const id = uuidParam(c)
    const rows = await attempt(c, 'personal-expenses.attachments', () =>
      // No try/catch here on purpose. This used to swallow the error and
      // return [], so a broken table read as "no attachments yet" — which is
      // exactly what it did for as long as the column names were wrong.
      withUser(
        c.env,
        c.get('auth').userId,
        (sql) => sql`select id, file_name, file_url, file_size, mime_type, created_at
            from expense_attachments
           where personal_expense_id = ${id} and company_id = ${c.get('auth').companyId}
           order by created_at desc`,
      ),
    )
    if (!rows) fail(400, 'We could not load attachments.')
    return c.json(rows)
  })

  .post('/:id/attachments', requireModule('personal_expenses'), async (c) => {
    const id = uuidParam(c)
    const body = await c.req.json().catch(() => ({})) as { file_name?: unknown; file_url?: unknown; file_size?: unknown; mime_type?: unknown }
    if (typeof body.file_name !== 'string' || typeof body.file_url !== 'string') fail(422, 'file_name and file_url are required.')
    const row = await attempt(c, 'personal-expenses.attachment_create', () =>
      withUser(c.env, c.get('auth').userId, async (sql) => {
        const rows = await sql`insert into expense_attachments ${sql({ company_id: c.get('auth').companyId, personal_expense_id: id, file_name: body.file_name as string, file_url: body.file_url as string, file_size: typeof body.file_size === 'number' ? body.file_size : null, mime_type: typeof body.mime_type === 'string' ? body.mime_type : null, created_by: c.get('auth').userId })}
          returning id, file_name, file_url, file_size, mime_type, created_at`
        return rows[0] ?? null
      }),
    )
    if (!row) fail(400, 'We could not add this attachment.')
    return c.json(row, 201)
  })

  .delete('/attachments/:attachmentId', requireModule('personal_expenses'), async (c) => {
    const attachmentId = uuidParam(c, 'attachmentId')
    const rows = await attempt(c, 'personal-expenses.attachment_delete', () =>
      withUser(c.env, c.get('auth').userId, (sql) => sql<{ id: string }[]>`
        delete from expense_attachments where id = ${attachmentId} and company_id = ${c.get('auth').companyId} returning id`),
    )
    if (!rows) fail(400, 'We could not delete this attachment.')
    if (!rows.length) fail(404, 'That attachment was not found.')
    return c.json(okResponse.parse({ ok: true }))
  })
