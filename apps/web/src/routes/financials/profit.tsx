import { useMemo, useState } from 'react'
import { IndianRupee, TrendingUp, Wallet, Building2, Users, ChevronDown, ChevronRight, Sigma } from 'lucide-react'
import { AuthedPage } from '@/shared/layout/AuthedPage'
import { PageHeader } from '@/shared/layout/page-header'
import { StatCard } from '@/shared/ui/stat-card'
import { Card, CardContent, CardHeader, CardTitle } from '@/shared/ui/card'
import { Button } from '@/shared/ui/button'
import { Input, Select } from '@/shared/ui/input'
import { Dialog, DialogContent, DialogTrigger } from '@/shared/ui/dialog'
import { ErrorState } from '@/shared/ui/states'
import { SkeletonTiles } from '@/shared/ui/skeleton'
import { StatusBadge } from '@/shared/ui/status-badge'
import { formatINR } from '@/shared/ui/format'
import { useMonthlyProfitSummary, useFixedOverheads, useCreateFixedOverhead, useUpdateFixedOverhead, useDeleteFixedOverhead } from '@/features/financials/api'
import { useProfitabilityReport } from '@/features/financials/api'

const CATS = ['rent', 'salaries', 'utilities', 'internet', 'software', 'insurance', 'maintenance', 'marketing', 'other'] as const
const ALLOCS = ['equal', 'revenue', 'shoot_days', 'headcount'] as const

/**
 * Lovable parity: monthly profit — month picker + cash/booked basis + alloc
 * equal/revenue/shoot_days/headcount + cards (Cash/Booked net-tax, Salary buckets,
 * Office Fixed, Fixed Total, Variable, Total Cost, Net, Margin) + warnings +
 * per-project breakdown (expandable Variable/Allocated/Actual) + Monthly Team
 * 5 buckets + FixedOverheads CRUD with Edit (PATCH).
 */
export function MonthlyProfitPage() {
  return (
    <AuthedPage module="financials">
      <Profit />
    </AuthedPage>
  )
}

function endOfMonth(month: string): string {
  const parts = month.split('-').map(Number)
  const y = parts[0] ?? 1970
  const m = parts[1] ?? 1
  const last = new Date(y, m, 0).getDate()
  return `${month.slice(0, 7)}-${String(last).padStart(2, '0')}`
}

function Profit() {
  const [month, setMonth] = useState(() => new Date().toISOString().slice(0, 7) + '-01')
  const [basis, setBasis] = useState<'cash' | 'booked'>('cash')
  const [alloc, setAlloc] = useState('equal')
  const { data, isLoading, isError, refetch } = useMonthlyProfitSummary(month, basis, alloc)
  const overheads = useFixedOverheads(month)
  const report = useProfitabilityReport({
    date_from: month,
    date_to: endOfMonth(month),
    sort_by: 'gross_profit',
    sort_direction: 'desc',
    page: 1,
    page_size: 50,
  })
  const [expanded, setExpanded] = useState<Set<string>>(new Set())

  if (isLoading) return <SkeletonTiles count={6} />
  if (isError || !data) return <ErrorState onRetry={() => void refetch()} />

  const fixedTotal = data.fixed_total
  const items = report.data?.items ?? []
  const totalPaid = items.reduce((s, i) => s + i.paid_income, 0)
  // Allocated fixed cost per project (client-side estimate, Lovable-style):
  // equal/headcount split evenly; revenue splits by paid share; shoot_days
  // has no day counts here so it falls back to even.
  const allocatedFor = (paid: number) => {
    if (items.length === 0 || fixedTotal <= 0) return 0
    if (alloc === 'revenue' && totalPaid > 0) return (fixedTotal * paid) / totalPaid
    return fixedTotal / items.length
  }

  // Monthly Team Cost — 5 named buckets (Lovable parity). The API returns
  // dynamic employment_type buckets; normalize to the five studio buckets.
  const bucketTotals = useMemo(() => {
    const acc: Record<string, number> = { salaried: 0, intern: 0, contractor: 0, commission: 0, other: 0 }
    for (const b of (data.salary_buckets as Record<string, unknown>[] | null | undefined) ?? []) {
      const name = String(b['bucket'] ?? 'other').toLowerCase()
      const total = Number(b['total'] ?? 0)
      if (name.includes('intern') || name.includes('stipend')) acc['intern'] = (acc['intern'] ?? 0) + total
      else if (name.includes('contract')) acc['contractor'] = (acc['contractor'] ?? 0) + total
      else if (name.includes('commission')) acc['commission'] = (acc['commission'] ?? 0) + total
      else if (name.includes('salar') || name.includes('full') || name.includes('staff')) acc['salaried'] = (acc['salaried'] ?? 0) + total
      else acc['other'] = (acc['other'] ?? 0) + total
    }
    return acc
  }, [data.salary_buckets])

  return (
    <>
      <PageHeader
        title="Monthly profit"
        description="Cash vs booked, side by side — pick a month, a basis, and how fixed costs split."
      />
      <div className="mb-4 flex flex-wrap items-end gap-2">
        <div>
          <label className="text-xs text-muted-foreground">Month</label>
          <Input type="month" value={month.slice(0, 7)} onChange={(e) => setMonth(`${e.target.value}-01`)} />
        </div>
        <div>
          <label className="text-xs text-muted-foreground">Basis</label>
          <Select value={basis} onChange={(e) => setBasis(e.target.value as typeof basis)}>
            <option value="cash">Cash (received)</option>
            <option value="booked">Booked (contract value)</option>
          </Select>
        </div>
        <div>
          <label className="text-xs text-muted-foreground">Overhead split</label>
          <Select value={alloc} onChange={(e) => setAlloc(e.target.value)}>
            <option value="equal">Equal</option>
            <option value="revenue">By revenue</option>
            <option value="shoot_days">By shoot days</option>
            <option value="headcount">By headcount</option>
          </Select>
        </div>
      </div>

      {(data.warnings?.length ?? 0) > 0 && (
        <Card className="mb-4 border-warning/40 bg-warning/10">
          <CardContent className="p-4 text-sm">
            {data.warnings!.map((w) => (
              <p key={w}>⚠ {w}</p>
            ))}
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Cash received" value={formatINR(data.cash_received)} icon={Wallet} />
        <StatCard label="Booked revenue" value={formatINR(data.booked_revenue)} icon={TrendingUp} />
        <StatCard label="Salary cost" value={formatINR(data.salary_cost)} icon={Users} />
        <StatCard label="Office fixed" value={formatINR(data.office_fixed)} icon={Building2} />
        <StatCard label="Fixed total" value={formatINR(data.fixed_total)} icon={Building2} />
        <StatCard label="Variable cost" value={formatINR(data.variable_cost)} icon={Wallet} />
        <StatCard label="Total cost" value={formatINR(data.total_cost)} icon={Sigma} hint="Fixed + variable" />
        <StatCard label={basis === 'cash' ? 'Net (cash)' : 'Net (booked)'} value={formatINR(basis === 'cash' ? data.net_cash : data.net_booked)} icon={IndianRupee} />
        <StatCard label="Margin" value={`${((basis === 'cash' ? data.margin_cash : data.margin_booked) ?? 0).toFixed(1)}%`} icon={TrendingUp} />
      </div>

      {/* Project profitability table with expandable Variable/Allocated/Actual */}
      <Card className="mt-4">
        <CardHeader><CardTitle>Project profitability ({items.length})</CardTitle></CardHeader>
        <CardContent>
          {report.isLoading ? (
            <p className="text-sm text-muted-foreground">Loading projects…</p>
          ) : report.isError ? (
            <ErrorState message="Could not load project profitability." onRetry={() => void report.refetch()} />
          ) : items.length === 0 ? (
            <p className="text-sm text-muted-foreground">No projects with activity in {month.slice(0, 7)}. Fixed cost allocation will appear once projects have shoots in this month.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-muted-foreground">
                    <th className="w-8 pb-2" />
                    <th className="pb-2 font-medium">Project</th>
                    <th className="pb-2 text-right font-medium">Paid</th>
                    <th className="pb-2 text-right font-medium">Variable</th>
                    <th className="pb-2 text-right font-medium">Allocated</th>
                    <th className="pb-2 text-right font-medium">Actual</th>
                    <th className="pb-2 text-right font-medium">Profit</th>
                    <th className="pb-2 text-right font-medium">Margin</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((r) => {
                    const variable = r.company_expense_total
                    const allocated = allocatedFor(r.paid_income)
                    const actual = variable + allocated
                    const profit = (basis === 'cash' ? r.paid_income : r.project_total_value) - actual
                    const isOpen = expanded.has(r.project_id)
                    return (
                      <>
                        <tr key={r.project_id} className="cursor-pointer border-b last:border-0 hover:bg-muted/40" onClick={() => setExpanded((prev) => {
                          const next = new Set(prev)
                          if (next.has(r.project_id)) next.delete(r.project_id)
                          else next.add(r.project_id)
                          return next
                        })}>
                          <td className="py-2">{isOpen ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}</td>
                          <td className="py-2 font-medium">{r.project_name}<span className="ml-2 text-xs font-normal text-muted-foreground">{r.project_status ?? ''}</span></td>
                          <td className="py-2 text-right tabular-nums">{formatINR(r.paid_income)}</td>
                          <td className="py-2 text-right tabular-nums text-muted-foreground">{formatINR(variable)}</td>
                          <td className="py-2 text-right tabular-nums text-muted-foreground">{formatINR(allocated)}</td>
                          <td className="py-2 text-right tabular-nums">{formatINR(actual)}</td>
                          <td className={`py-2 text-right font-semibold tabular-nums ${profit < 0 ? 'text-destructive' : 'text-success'}`}>{formatINR(profit)}</td>
                          <td className="py-2 text-right tabular-nums">{r.gross_margin.toFixed(1)}%</td>
                        </tr>
                        {isOpen && (
                          <tr key={`${r.project_id}-detail`} className="bg-muted/20">
                            <td />
                            <td colSpan={7} className="space-y-2 py-3 text-xs">
                              <div className="rounded-md border border-border bg-card p-3">
                                <p className="font-semibold">Variable cost — {formatINR(variable)}</p>
                                <p className="mt-1 text-muted-foreground">Project-level company expenses booked to {r.project_name} in range.</p>
                              </div>
                              <div className="rounded-md border border-border bg-card p-3">
                                <p className="font-semibold">Allocated fixed cost — {formatINR(allocated)}</p>
                                <p className="mt-1 text-muted-foreground">
                                  Method: {alloc} · pool {formatINR(fixedTotal)} across {items.length} projects
                                  {alloc === 'revenue' && totalPaid > 0 ? ` · share ${((r.paid_income / totalPaid) * 100).toFixed(1)}% of paid income` : ' · even share'}
                                  {alloc === 'shoot_days' ? ' (no day counts in this report — even share used)' : ''}
                                  {alloc === 'headcount' ? ' (headcount split — even share across eligible projects)' : ''}.
                                </p>
                              </div>
                              <div className="rounded-md border border-border bg-card p-3">
                                <p className="font-semibold">Actual cost & profit</p>
                                <p className="mt-1 text-muted-foreground">
                                  Actual = Variable + Allocated = {formatINR(variable)} + {formatINR(allocated)} = {formatINR(actual)}.
                                  {' '}Profit ({basis}) = {formatINR(basis === 'cash' ? r.paid_income : r.project_total_value)} − {formatINR(actual)} = {formatINR(profit)}.
                                  {r.attention_flags.length > 0 ? ` Flags: ${r.attention_flags.join(', ')}.` : ''}
                                </p>
                              </div>
                            </td>
                          </tr>
                        )}
                      </>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Monthly Team Cost — 5 named buckets */}
      <Card className="mt-4">
        <CardHeader><CardTitle>Monthly team cost (5 buckets)</CardTitle></CardHeader>
        <CardContent>
          <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            {[
              { label: 'Salaried Staff', value: bucketTotals['salaried'] ?? 0 },
              { label: 'Intern Stipends', value: bucketTotals['intern'] ?? 0 },
              { label: 'Contractor Retainers', value: bucketTotals['contractor'] ?? 0 },
              { label: 'Commission Base', value: bucketTotals['commission'] ?? 0 },
              { label: 'Other', value: bucketTotals['other'] ?? 0 },
            ].map((b) => (
              <li key={b.label} className="rounded-lg border border-border p-3">
                <p className="text-xs text-muted-foreground">{b.label}</p>
                <p className="mt-1 text-lg font-semibold tabular-nums">{formatINR(b.value ?? 0)}</p>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-muted-foreground">Salary cost total {formatINR(data.salary_cost)} · fixed total {formatINR(data.fixed_total)} · total cost {formatINR(data.total_cost)}.</p>
        </CardContent>
      </Card>

      <Card className="mt-4">
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle>Fixed overheads</CardTitle>
            <OverheadDialog month={month} />
          </div>
        </CardHeader>
        <CardContent>
          {!overheads.data || overheads.data.length === 0 ? (
            <p className="text-sm text-muted-foreground">No overheads for this month — add rent, salaries, utilities…</p>
          ) : (
            <ul className="divide-y divide-border text-sm">
              {overheads.data.map((o) => (
                <OverheadRow key={o.id} id={o.id} category={o.category} label={o.label} amount={o.amount} alloc={o.alloc_basis} month={month} />
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </>
  )
}

function OverheadRow({ id, category, label, amount, alloc, month }: { id: string; category: string; label: string | null; amount: number; alloc: string; month: string }) {
  const del = useDeleteFixedOverhead()
  const [editing, setEditing] = useState(false)
  return (
    <li className="flex items-center justify-between gap-3 py-2">
      <span>
        <span className="font-medium">{label ?? category}</span>{' '}
        <StatusBadge>{alloc}</StatusBadge>
      </span>
      <span className="flex items-center gap-2">
        <span className="tabular-nums">{formatINR(amount)}</span>
        <Button size="sm" variant="ghost" onClick={() => setEditing(true)}>Edit</Button>
        <Button size="sm" variant="ghost" className="text-destructive" disabled={del.isPending} onClick={() => del.mutate(id)}>
          Delete
        </Button>
      </span>
      {editing && <OverheadDialog month={month} editing={{ id, category, label, amount, alloc_basis: alloc }} onDone={() => setEditing(false)} />}
    </li>
  )
}

function OverheadDialog({ month, editing, onDone }: { month: string; editing?: { id: string; category: string; label: string | null; amount: number; alloc_basis: string }; onDone?: () => void }) {
  const create = useCreateFixedOverhead()
  const update = useUpdateFixedOverhead()
  const [open, setOpen] = useState(!!editing)
  const [category, setCategory] = useState<string>(editing?.category ?? 'rent')
  const [label, setLabel] = useState(editing?.label ?? '')
  const [amount, setAmount] = useState(editing ? String(editing.amount) : '')
  const [alloc, setAlloc] = useState<string>(editing?.alloc_basis ?? 'equal')
  const isEdit = !!editing
  const busy = create.isPending || update.isPending

  function close(v: boolean) {
    if (editing) {
      if (!v) onDone?.()
    } else {
      setOpen(v)
    }
  }

  return (
    <Dialog open={editing ? true : open} onOpenChange={close}>
      {!editing && (
        <DialogTrigger asChild>
          <Button size="sm">Add overhead</Button>
        </DialogTrigger>
      )}
      <DialogContent title={isEdit ? 'Edit fixed overhead' : 'Add fixed overhead'}>
        <div className="mt-3 flex flex-col gap-2">
          <Select value={category} onChange={(e) => setCategory(e.target.value)}>
            {CATS.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </Select>
          <Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Label (optional)" />
          <Input type="number" min={0} value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="Amount ₹" />
          <Select value={alloc} onChange={(e) => setAlloc(e.target.value)}>
            {ALLOCS.map((a) => (
              <option key={a} value={a}>{a}</option>
            ))}
          </Select>
          <Button
            disabled={busy || !amount}
            onClick={() => {
              if (isEdit && editing) {
                update.mutate({
                  id: editing.id,
                  patch: {
                    category: category as (typeof CATS)[number],
                    label: label || undefined,
                    amount: Number(amount),
                    alloc_basis: alloc as (typeof ALLOCS)[number],
                    month,
                  },
                }, { onSuccess: () => onDone?.() })
              } else {
                create.mutate({
                  category: category as (typeof CATS)[number],
                  label: label || undefined,
                  amount: Number(amount),
                  alloc_basis: alloc as (typeof ALLOCS)[number],
                  month,
                }, { onSuccess: () => setOpen(false) })
              }
            }}
          >
            {busy ? 'Saving…' : isEdit ? 'Save changes' : 'Add'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
