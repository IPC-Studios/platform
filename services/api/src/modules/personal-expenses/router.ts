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
import { uuidParam } from '../../lib/params'
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
    const cursor = c.req.query('cursor')
    if (cursor && Number.isNaN(Date.parse(cursor))) fail(422, 'Invalid cursor.')
    const limitRaw = Number(c.req.query('limit') ?? 100)
    const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(Math.trunc(limitRaw), 1), 200) : 100

    const rows = await attempt(c, 'personal-expenses.list', () =>
      withUser(c.env, c.get('auth').userId, async (sql) => {
        const result = await sql<{ list_personal_expenses: unknown }[]>`
          select list_personal_expenses(
            p_search => ${search},
            p_category => ${category},
            p_cursor => ${cursor ? cursor : null}::timestamptz,
            p_limit => ${limit}
          ) as list_personal_expenses`
        return rpcJson(result[0]?.list_personal_expenses, {})
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
        const made = await sql<{ id: string }[]>`
          insert into personal_expense (company_id, user_id, party_id, amount, expense_date, category, gst_treatment, description)
          values (${auth.companyId}, ${auth.userId}, ${d.party_id ?? null}, ${d.amount},
                  ${d.expense_date ?? new Date().toISOString().slice(0, 10)}::date,
                  ${d.category ?? null}, ${d.gst_treatment}, ${d.description ?? null})
          returning id`
        return made
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
        // Build dynamic SET clause: only update provided fields, keep existing values otherwise
        return sql<{ id: string }[]>`
          update personal_expense
             set party_id = coalesce(${d.party_id ?? null}::uuid, party_id),
                 amount = coalesce(${d.amount ?? null}::numeric, amount),
                 expense_date = coalesce(${d.expense_date ?? null}::date, expense_date),
                 category = coalesce(${d.category ?? null}, category),
                 gst_treatment = coalesce(${d.gst_treatment ?? null}, gst_treatment),
                 description = coalesce(${d.description ?? null}, description)
           where id = ${id} and company_id = ${auth.companyId} and user_id = ${auth.userId}
           returning id`
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
