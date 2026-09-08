import { useState, type FormEvent } from 'react'
import { Plus, Wallet } from 'lucide-react'
import type { CreateExpenseRequest } from '@ipc/contracts'

const todayISO = () => new Date().toISOString().slice(0, 10)
const GST_RATES = [0, 5, 12, 18, 28]
import { AuthedPage } from '@/shared/layout/AuthedPage'
import { PageHeader } from '@/shared/layout/page-header'
import { Button } from '@/shared/ui/button'
import { SkeletonList } from '@/shared/ui/skeleton'
import { Dialog, DialogClose, DialogContent, DialogTrigger } from '@/shared/ui/dialog'
import { Input, Label, Select } from '@/shared/ui/input'
import { StatusBadge } from '@/shared/ui/status-badge'
import { ErrorState, EmptyState } from '@/shared/ui/states'
import { RecordCard, RecordCards } from '@/shared/ui/record-card'
import { useIsMobile } from '@/shared/hooks/use-mobile'
import { formatINR, humanize } from '@/shared/ui/format'
import { Card, CardContent } from '@/shared/ui/card'
import { BarChart, ShareChart } from '@/shared/ui/chart'
import { groupBy, monthlySeries } from '@/shared/ui/chart-geometry'
import { useExpenses, useCreateExpense } from '@/features/financials/api'
import { useProjects } from '@/features/projects/api'
import { PartyPicker } from '@/features/parties/PartyPicker'

export function CompanyExpensesPage() {
  return (
    <AuthedPage module="company_expenses">
      <Expenses />
    </AuthedPage>
  )
}

function Expenses() {
  const { data, isLoading, isError, refetch } = useExpenses()
  const isMobile = useIsMobile()
  const total = (data ?? []).reduce((s, e) => s + e.amount, 0)

  return (
    <>
      <PageHeader
        title="Company expenses"
        description={`Total ${formatINR(total)}`}
        actions={<AddExpenseDialog />}
      />
      {isLoading ? (
        <SkeletonList rows={5} columns={5} />
      ) : isError ? (
        <ErrorState onRetry={() => void refetch()} />
      ) : !data || data.length === 0 ? (
        <EmptyState title="No expenses logged" description="Track studio costs to see accurate profit." action={<AddExpenseDialog />} />
      ) : (
        <>
        <div className="grid gap-4 lg:grid-cols-2">
          <Card>
            <CardContent className="p-5">
              <h2 className="font-semibold tracking-tight">Spend by month</h2>
              <p className="mt-0.5 text-sm text-muted-foreground">The last six months.</p>
              <BarChart
                className="mt-4"
                points={monthlySeries(data, (e) => e.expense_date, (e) => e.amount)}
                format={formatINR}
              />
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-5">
              <h2 className="font-semibold tracking-tight">By category</h2>
              <p className="mt-0.5 text-sm text-muted-foreground">Where the money actually goes.</p>
              <ShareChart
                className="mt-4"
                points={groupBy(data, (e) => e.category, (e) => e.amount)}
                format={formatINR}
              />
            </CardContent>
          </Card>
        </div>

        <div className="mt-6">
        {isMobile ? (
          <RecordCards>
            {data.map((e) => (
              <RecordCard
                key={e.id}
                title={
                  <span className="flex items-center gap-2">
                    <Wallet className="size-4 text-muted-foreground" />
                    {e.category ?? '—'}
                  </span>
                }
                subtitle={e.description ?? '—'}
                badge={e.is_fixed_overhead ? <StatusBadge tone="info">overhead</StatusBadge> : undefined}
                fields={[
                  { label: 'Date', value: e.expense_date },
                  { label: 'GST', value: humanize(e.gst_treatment) },
                  { label: 'Amount', value: formatINR(e.amount), strong: true },
                ]}
              />
            ))}
          </RecordCards>
        ) : (
        <div className="table-wrap rounded-lg border border-border">
          <table className="table-sticky w-full text-sm">
            <thead className="bg-muted/50 text-left text-muted-foreground">
              <tr>
                <th className="px-4 py-2 font-medium">Category</th>
                <th className="px-4 py-2 font-medium">Description</th>
                <th className="px-4 py-2 font-medium">Date</th>
                <th className="px-4 py-2 font-medium">GST</th>
                <th className="px-4 py-2 text-right font-medium">Amount</th>
              </tr>
            </thead>
            <tbody>
              {data.map((e) => (
                <tr key={e.id} className="border-t border-border">
                  <td className="px-4 py-2 font-medium">
                    <span className="flex items-center gap-2">
                      <Wallet className="size-4 text-muted-foreground" />
                      {e.category ?? '—'}
                      {e.is_fixed_overhead && <StatusBadge tone="info">overhead</StatusBadge>}
                    </span>
                  </td>
                  <td className="px-4 py-2 text-muted-foreground">{e.description ?? '—'}</td>
                  <td className="px-4 py-2 text-muted-foreground">{e.expense_date}</td>
                  <td className="px-4 py-2 text-muted-foreground">{humanize(e.gst_treatment)}</td>
                  <td className="px-4 py-2 text-right font-medium">{formatINR(e.amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        )}
        </div>
        </>
      )}
    </>
  )
}

function AddExpenseDialog() {
  const create = useCreateExpense()
  const { data: projects } = useProjects()
  const [open, setOpen] = useState(false)
  const [category, setCategory] = useState('')
  const [description, setDescription] = useState('')
  const [amount, setAmount] = useState(0)
  const [expenseDate, setExpenseDate] = useState(todayISO())
  const [projectId, setProjectId] = useState('')
  const [partyId, setPartyId] = useState('')
  const [overhead, setOverhead] = useState(false)
  const [gstTreatment, setGstTreatment] = useState<CreateExpenseRequest['gst_treatment']>('non_gst')
  const [gstRate, setGstRate] = useState(18)
  const [error, setError] = useState<string | null>(null)

  function reset() {
    setCategory('')
    setDescription('')
    setAmount(0)
    setExpenseDate(todayISO())
    setProjectId('')
    setPartyId('')
    setOverhead(false)
    setGstTreatment('non_gst')
    setGstRate(18)
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    try {
      const body: CreateExpenseRequest = {
        // A fixed-overhead expense is shared across every project (see
        // Settings → Financials); pinning it to one project too would count
        // it twice.
        project_id: overhead ? null : projectId || null,
        party_id: partyId || null,
        amount,
        expense_date: expenseDate,
        is_fixed_overhead: overhead,
        gst_treatment: gstTreatment,
        ...(gstTreatment === 'gst_applicable' ? { gst_rate: gstRate } : {}),
        ...(category.trim() ? { category: category.trim() } : {}),
        ...(description.trim() ? { description: description.trim() } : {}),
      }
      await create.mutateAsync(body)
      setOpen(false)
      reset()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not add the expense.')
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <Plus /> Add expense
        </Button>
      </DialogTrigger>
      <DialogContent title="Add expense" description="Log a studio or project cost.">
        <form onSubmit={onSubmit} className="flex flex-col gap-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <Label>Category</Label>
              <Input value={category} onChange={(e) => setCategory(e.target.value)} placeholder="Travel" />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>Amount ₹</Label>
              <Input type="number" min={0} value={amount} onChange={(e) => setAmount(Number(e.target.value))} required />
            </div>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>Description</Label>
            <Input value={description} onChange={(e) => setDescription(e.target.value)} />
          </div>

          <PartyPicker value={partyId} onChange={setPartyId} />

          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <Label>Date</Label>
              <Input type="date" value={expenseDate} onChange={(e) => setExpenseDate(e.target.value)} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>Project</Label>
              <Select value={projectId} onChange={(e) => setProjectId(e.target.value)} disabled={overhead}>
                <option value="">{overhead ? 'Shared across all projects' : 'Not linked to a project'}</option>
                {(projects ?? []).map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </Select>
            </div>
          </div>

          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={overhead}
              onChange={(e) => {
                setOverhead(e.target.checked)
                if (e.target.checked) setProjectId('')
              }}
            />
            Fixed overhead (shared equally across every active project)
          </label>

          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <Label>GST treatment</Label>
              <Select value={gstTreatment} onChange={(e) => setGstTreatment(e.target.value as CreateExpenseRequest['gst_treatment'])}>
                <option value="non_gst">No GST</option>
                <option value="gst_applicable">GST applicable</option>
                <option value="exempt">Exempt</option>
                <option value="reverse_charge">Reverse charge</option>
              </Select>
            </div>
            {gstTreatment === 'gst_applicable' && (
              <div className="flex flex-col gap-1.5">
                <Label>GST rate</Label>
                <Select value={gstRate} onChange={(e) => setGstRate(Number(e.target.value))}>
                  {GST_RATES.map((r) => (
                    <option key={r} value={r}>
                      {r}%
                    </option>
                  ))}
                </Select>
              </div>
            )}
          </div>

          {error && (
            <p id="form-error" role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          <div className="flex justify-end gap-2">
            <DialogClose asChild>
              <Button type="button" variant="outline">
                Cancel
              </Button>
            </DialogClose>
            <Button type="submit" disabled={create.isPending}>
              {create.isPending ? 'Saving…' : 'Add'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
