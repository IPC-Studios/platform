import { Hono } from 'hono'
import { createExpenseRequest, expense, projectFinancials } from '@ipc/contracts'
import { grossProfit, balancePending } from '@ipc/domain'
import type { AppEnv } from '../../context'
import { requireAuth } from '../../middleware/auth'
import { requireModule } from '../../middleware/permissions'
import { fail } from '../../middleware/errors'
import { withUser } from '../../lib/db'
import { attempt } from '../../lib/attempt'
import { audit } from '../../lib/audit'

const expenses = expense.array()
const financials = projectFinancials.array()

interface FinancialRow {
  project_id: string
  name: string
  revenue: number
  received: number
  direct_team_cost: number
  project_expenses: number
}

export const financialsRouter = new Hono<AppEnv>()
  .use('*', requireAuth)

  // ── Expenses (company_expenses module) ──────────────────────
  .get('/expenses', requireModule('company_expenses'), async (c) => {
    const rows = await attempt(c, 'financials.expenses', () =>
      withUser(
        c.env,
        c.get('auth').userId,
        (sql) => sql`
          select id, project_id, category, description, amount, expense_date, gst_treatment, is_fixed_overhead
          from expenses order by expense_date desc`,
      ),
    )
    if (!rows) fail(400, 'We could not load expenses.')
    return c.json(expenses.parse(rows))
  })

  .post('/expenses', requireModule('company_expenses'), async (c) => {
    const parsed = createExpenseRequest.safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success) fail(422, 'Please check the expense details.')
    const auth = c.get('auth')
    const row = await attempt(c, 'financials.expense_create', () =>
      withUser(c.env, auth.userId, async (sql) => {
        const rows = await sql`
          insert into expenses ${sql({ ...parsed.data, company_id: auth.companyId, created_by: auth.userId })}
          returning id, project_id, category, description, amount, expense_date, gst_treatment, is_fixed_overhead`
        return rows[0] ?? null
      }),
    )
    if (!row) fail(400, 'We could not add the expense.')
    const created = expense.parse(row)
    await audit(c, { action: 'expense.create', entityType: 'expense', entityId: created.id, after: parsed.data })
    return c.json(created, 201)
  })

  // ── Profit summary (financials module) ──────────────────────
  .get('/projects', requireModule('financials'), async (c) => {
    const data = await attempt(c, 'financials.projects', () =>
      withUser(
        c.env,
        c.get('auth').userId,
        (sql) => sql<FinancialRow[]>`
          select project_id, name, revenue, received, direct_team_cost, project_expenses
          from project_financials`,
      ),
    )
    if (!data) fail(400, 'We could not load financials.')
    const rows = data.map((row) => ({
      ...row,
      gross_profit: grossProfit({
        revenue: row.revenue,
        directTeamCost: row.direct_team_cost,
        projectExpenses: row.project_expenses,
      }),
      balance_pending: balancePending(row.revenue, row.received),
    }))
    return c.json(financials.parse(rows))
  })
