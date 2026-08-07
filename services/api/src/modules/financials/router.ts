import { Hono } from 'hono'
import { createExpenseRequest, expense, projectFinancials } from '@ipc/contracts'
import { grossProfit, balancePending } from '@ipc/domain'
import type { AppEnv } from '../../context'
import { requireAuth } from '../../middleware/auth'
import { requireModule } from '../../middleware/permissions'
import { fail } from '../../middleware/errors'
import { requestClient } from '../../lib/supabase'

const expenses = expense.array()
const financials = projectFinancials.array()

export const financialsRouter = new Hono<AppEnv>()
  .use('*', requireAuth)

  // ── Expenses (company_expenses module) ──────────────────────
  .get('/expenses', requireModule('company_expenses'), async (c) => {
    const { data, error } = await requestClient(c)
      .from('expenses')
      .select('id,project_id,category,description,amount,expense_date,gst_treatment,is_fixed_overhead')
      .order('expense_date', { ascending: false })
    if (error) fail(400, 'We could not load expenses.')
    return c.json(expenses.parse(data ?? []))
  })

  .post('/expenses', requireModule('company_expenses'), async (c) => {
    const parsed = createExpenseRequest.safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success) fail(422, 'Please check the expense details.')
    const { data, error } = await requestClient(c)
      .from('expenses')
      .insert({ ...parsed.data, company_id: c.get('auth').companyId, created_by: c.get('auth').userId })
      .select('id,project_id,category,description,amount,expense_date,gst_treatment,is_fixed_overhead')
      .single()
    if (error || !data) fail(400, 'We could not add the expense.')
    return c.json(expense.parse(data), 201)
  })

  // ── Profit summary (financials module) ──────────────────────
  .get('/projects', requireModule('financials'), async (c) => {
    const { data, error } = await requestClient(c)
      .from('project_financials')
      .select('project_id,name,revenue,received,direct_team_cost,project_expenses')
    if (error) fail(400, 'We could not load financials.')
    const rows = (data ?? []).map((r) => {
      const row = r as {
        project_id: string
        name: string
        revenue: number
        received: number
        direct_team_cost: number
        project_expenses: number
      }
      return {
        ...row,
        gross_profit: grossProfit({
          revenue: row.revenue,
          directTeamCost: row.direct_team_cost,
          projectExpenses: row.project_expenses,
        }),
        balance_pending: balancePending(row.revenue, row.received),
      }
    })
    return c.json(financials.parse(rows))
  })
