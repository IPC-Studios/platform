import { useEffect, useState } from 'react'

function useDebounce<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delay)
    return () => clearTimeout(t)
  }, [value, delay])
  return debounced
}
import { AuthedPage } from '@/shared/layout/AuthedPage'
import { PageHeader } from '@/shared/layout/page-header'
import { FilterTabs } from '@/shared/layout/filter-tabs'
import { StatCard } from '@/shared/ui/stat-card'
import { Button } from '@/shared/ui/button'
import { Input } from '@/shared/ui/input'
import { Dialog, DialogContent } from '@/shared/ui/dialog'
import { Select } from '@/shared/ui/select'
import {
  usePersonalExpenses,
  usePersonalExpenseReport,
  useSavePersonalExpense,
  useDeletePersonalExpense,
} from '@/features/personal-expenses/api'
import { PERSONAL_EXPENSE_CATEGORIES, type CreatePersonalExpenseRequest } from '@ipc/contracts'
import { PartyPicker } from '@/features/parties/PartyPicker'

const GST_RATES = [0, 5, 12, 18, 28]
const todayISO = () => new Date().toISOString().slice(0, 10)
import { Plus, Search, Trash2, Edit, Wallet, Calendar, BarChart3 } from 'lucide-react'

function PersonalExpensesContent() {
  const [search, setSearch] = useState('')
  const debouncedSearch = useDebounce(search, 300)
  const [category, setCategory] = useState<string>('all')
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [form, setForm] = useState<CreatePersonalExpenseRequest>({
    amount: 0,
    category: null,
    description: null,
    expense_date: todayISO(),
    gst_treatment: 'non_gst',
    gst_rate: null,
    party_id: null,
  })
  // Kept separate from `form.amount` (a number, for the request body) so the
  // field displays exactly what was typed instead of fighting a
  // type="number" input's leading-zero quirks.
  const [amountText, setAmountText] = useState('')

  const { data, fetchNextPage, hasNextPage, isFetchingNextPage } = usePersonalExpenses({
    search: debouncedSearch,
    category: category === 'all' ? undefined : category,
  })

  const saveMutation = useSavePersonalExpense()
  const deleteMutation = useDeletePersonalExpense()

  const items = data?.pages.flatMap((p) => p.items) ?? []
  const summary = data?.pages[0]?.summary

  function openCreate() {
    setEditingId(null)
    setForm({
      amount: 0,
      category: null,
      description: null,
      expense_date: todayISO(),
      gst_treatment: 'non_gst',
      gst_rate: null,
      party_id: null,
    })
    setAmountText('')
    setDialogOpen(true)
  }

  function openEdit(item: (typeof items)[0]) {
    setEditingId(item.id)
    setForm({
      amount: item.amount,
      category: item.category as CreatePersonalExpenseRequest['category'],
      description: item.description,
      expense_date: item.expense_date,
      gst_treatment: item.gst_treatment as CreatePersonalExpenseRequest['gst_treatment'],
      gst_rate: item.gst_rate,
      party_id: item.party_id,
    })
    setAmountText(String(item.amount))
    setDialogOpen(true)
  }

  function handleSubmit() {
    if (form.amount <= 0) return
    saveMutation.mutate(
      { id: editingId ?? undefined, body: form },
      { onSuccess: () => setDialogOpen(false) },
    )
  }

  const categoryLabels: Record<string, string> = {
    travel: 'Travel',
    food: 'Food',
    accommodation: 'Accommodation',
    supplies: 'Supplies',
    communication: 'Communication',
    equipment: 'Equipment',
    other: 'Other',
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Personal Expenses"
        description="Track your personal expenses"
        actions={
          <div className="flex gap-2">
            <ReportDialog />
            <Button onClick={openCreate} size="sm">
              <Plus className="mr-1 h-4 w-4" /> Add Expense
            </Button>
          </div>
        }
      />

      {summary && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard label="Total Expenses" value={summary.total_count} icon={Wallet} />
          <StatCard label="Total Amount" value={`₹${summary.total_amount.toLocaleString()}`} icon={BarChart3} />
          <StatCard label="This Month" value={summary.this_month_count} icon={Calendar} />
          <StatCard label="This Month Amount" value={`₹${summary.this_month_amount.toLocaleString()}`} icon={BarChart3} />
        </div>
      )}

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search expenses..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
        <FilterTabs
          value={category}
          onChange={setCategory}
          tabs={[
            { label: 'All', value: 'all' },
            ...PERSONAL_EXPENSE_CATEGORIES.map((c) => ({ label: categoryLabels[c] ?? c, value: c })),
          ]}
        />
      </div>

      <div className="space-y-2">
        {items.map((item) => (
          <div
            key={item.id}
            className="flex items-center justify-between rounded-lg border bg-card p-4 transition-colors hover:bg-accent/50"
          >
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="font-medium">₹{item.amount.toLocaleString()}</span>
                {item.category && (
                  <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs text-primary">
                    {categoryLabels[item.category] ?? item.category}
                  </span>
                )}
              </div>
              {item.description && (
                <p className="mt-1 truncate text-sm text-muted-foreground">{item.description}</p>
              )}
              <p className="mt-1 text-xs text-muted-foreground">
                {item.expense_date}
                {item.party_name ? ` · ${item.party_name}` : ''}
              </p>
            </div>
            <div className="flex items-center gap-1">
              <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => openEdit(item)}>
                <Edit className="h-4 w-4" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 text-destructive"
                onClick={() => { if (confirm('Delete this expense?')) deleteMutation.mutate(item.id) }}
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          </div>
        ))}
        {items.length === 0 && (
          <div className="py-12 text-center text-muted-foreground">No expenses found.</div>
        )}
        {hasNextPage && (
          <Button
            variant="outline"
            className="w-full"
            onClick={() => fetchNextPage()}
            disabled={isFetchingNextPage}
          >
            {isFetchingNextPage ? 'Loading...' : 'Load more'}
          </Button>
        )}
      </div>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent title={editingId ? 'Edit Expense' : 'Add Expense'}>
          <div className="space-y-4">
            <div>
              <label className="text-sm font-medium">Amount (₹)</label>
              <Input
                inputMode="decimal"
                value={amountText}
                onChange={(e) => {
                  setAmountText(e.target.value)
                  setForm({ ...form, amount: Number(e.target.value) || 0 })
                }}
                placeholder="0.00"
              />
            </div>
            <div>
              <label className="text-sm font-medium">Date</label>
              <Input
                type="date"
                value={form.expense_date ?? todayISO()}
                onChange={(e) => setForm({ ...form, expense_date: e.target.value })}
              />
            </div>
            <div>
              <label className="text-sm font-medium">Category</label>
              <Select value={form.category ?? ''} onChange={(e) => setForm({ ...form, category: (e.target.value || null) as CreatePersonalExpenseRequest['category'] })}>
                <option value="">Select category</option>
                {PERSONAL_EXPENSE_CATEGORIES.map((c) => (
                  <option key={c} value={c}>{categoryLabels[c] ?? c}</option>
                ))}
              </Select>
            </div>
            <PartyPicker value={form.party_id ?? ''} onChange={(id) => setForm({ ...form, party_id: id || null })} />
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-sm font-medium">GST treatment</label>
                <Select
                  value={form.gst_treatment}
                  onChange={(e) => setForm({ ...form, gst_treatment: e.target.value as CreatePersonalExpenseRequest['gst_treatment'] })}
                >
                  <option value="non_gst">No GST</option>
                  <option value="gst_applicable">GST applicable</option>
                  <option value="exempt">Exempt</option>
                  <option value="reverse_charge">Reverse charge</option>
                </Select>
              </div>
              {form.gst_treatment === 'gst_applicable' && (
                <div>
                  <label className="text-sm font-medium">GST rate</label>
                  <Select value={form.gst_rate ?? 18} onChange={(e) => setForm({ ...form, gst_rate: Number(e.target.value) })}>
                    {GST_RATES.map((r) => (
                      <option key={r} value={r}>
                        {r}%
                      </option>
                    ))}
                  </Select>
                </div>
              )}
            </div>
            <div>
              <label className="text-sm font-medium">Description</label>
              <Input
                value={form.description ?? ''}
                onChange={(e) => setForm({ ...form, description: e.target.value || null })}
                placeholder="What was this expense for?"
              />
            </div>
          </div>
          <div className="mt-6 flex justify-end gap-2">
            <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button>
            <Button onClick={handleSubmit} disabled={form.amount <= 0 || saveMutation.isPending}>
              {saveMutation.isPending ? 'Saving...' : 'Save'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}

function firstOfMonth(): string {
  const d = new Date()
  return new Date(d.getFullYear(), d.getMonth(), 1).toISOString().slice(0, 10)
}

/** Category and day breakdown for a date range — the backend's had this since round 1, the UI never asked for it. */
function ReportDialog() {
  const [open, setOpen] = useState(false)
  const [startDate, setStartDate] = useState(firstOfMonth())
  const [endDate, setEndDate] = useState(todayISO())
  const { data, isLoading, isError } = usePersonalExpenseReport(open ? startDate : '', open ? endDate : '')

  return (
    <>
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        <BarChart3 className="mr-1 h-4 w-4" /> Report
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent title="Personal expense report" description="Category and day-by-day breakdown for a date range.">
        <div className="flex flex-col gap-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-sm font-medium">From</label>
              <Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} max={endDate} />
            </div>
            <div>
              <label className="text-sm font-medium">To</label>
              <Input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} min={startDate} />
            </div>
          </div>

          {isLoading ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : isError ? (
            <p className="text-sm text-destructive">Could not load the report.</p>
          ) : !data ? null : (
            <>
              <div className="rounded-lg border bg-muted/30 p-3 text-center">
                <p className="text-xs text-muted-foreground">Total, {data.period_start} to {data.period_end}</p>
                <p className="text-xl font-semibold">₹{data.total_amount.toLocaleString()}</p>
              </div>

              <div>
                <p className="mb-2 text-sm font-medium">By category</p>
                {data.by_category.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No expenses in this range.</p>
                ) : (
                  <ul className="flex flex-col gap-1.5">
                    {data.by_category.map((c) => (
                      <li key={c.category ?? '—'} className="flex items-center justify-between text-sm">
                        <span>
                          {c.category ?? 'Uncategorised'} <span className="text-muted-foreground">({c.count})</span>
                        </span>
                        <span className="font-medium">₹{c.amount.toLocaleString()}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              {data.daily_breakdown.length > 0 && (
                <div>
                  <p className="mb-2 text-sm font-medium">By day</p>
                  <ul className="flex max-h-48 flex-col gap-1 overflow-y-auto">
                    {data.daily_breakdown.map((d) => (
                      <li key={d.date} className="flex items-center justify-between text-xs text-muted-foreground">
                        <span>{d.date}</span>
                        <span>₹{d.amount.toLocaleString()} · {d.count} {d.count === 1 ? 'expense' : 'expenses'}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </>
          )}

          <div className="flex justify-end">
            <Button variant="outline" onClick={() => setOpen(false)}>
              Close
            </Button>
          </div>
        </div>
      </DialogContent>
      </Dialog>
    </>
  )
}

export function PersonalExpensesPage() {
  return (
    <AuthedPage module="personal_expenses">
      <PersonalExpensesContent />
    </AuthedPage>
  )
}
