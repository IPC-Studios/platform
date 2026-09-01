import { useState, type FormEvent } from 'react'
import { Plus, Wallet } from 'lucide-react'
import type { CreateExpenseRequest } from '@ipc/contracts'
import { AuthedPage } from '@/shared/layout/AuthedPage'
import { PageHeader } from '@/shared/layout/page-header'
import { Button } from '@/shared/ui/button'
import { Dialog, DialogClose, DialogContent, DialogTrigger } from '@/shared/ui/dialog'
import { Input, Label } from '@/shared/ui/input'
import { StatusBadge } from '@/shared/ui/status-badge'
import { LoadingState, ErrorState, EmptyState } from '@/shared/ui/states'
import { formatINR, humanize } from '@/shared/ui/format'
import { Card, CardContent } from '@/shared/ui/card'
import { BarChart, ShareChart } from '@/shared/ui/chart'
import { groupBy, monthlySeries } from '@/shared/ui/chart-geometry'
import { useExpenses, useCreateExpense } from '@/features/financials/api'

export function CompanyExpensesPage() {
  return (
    <AuthedPage module="company_expenses">
      <Expenses />
    </AuthedPage>
  )
}

function Expenses() {
  const { data, isLoading, isError, refetch } = useExpenses()
  const total = (data ?? []).reduce((s, e) => s + e.amount, 0)

  return (
    <>
      <PageHeader
        title="Company expenses"
        description={`Total ${formatINR(total)}`}
        actions={<AddExpenseDialog />}
      />
      {isLoading ? (
        <LoadingState />
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

        <div className="mt-6 table-wrap rounded-lg border border-border">
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
        </>
      )}
    </>
  )
}

function AddExpenseDialog() {
  const create = useCreateExpense()
  const [open, setOpen] = useState(false)
  const [category, setCategory] = useState('')
  const [description, setDescription] = useState('')
  const [amount, setAmount] = useState(0)
  const [overhead, setOverhead] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    try {
      const body: CreateExpenseRequest = {
        project_id: null,
        amount,
        is_fixed_overhead: overhead,
        gst_treatment: 'non_gst',
        ...(category.trim() ? { category: category.trim() } : {}),
        ...(description.trim() ? { description: description.trim() } : {}),
      }
      await create.mutateAsync(body)
      setOpen(false)
      setCategory('')
      setDescription('')
      setAmount(0)
      setOverhead(false)
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
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={overhead} onChange={(e) => setOverhead(e.target.checked)} />
            Fixed overhead (allocated across projects)
          </label>
          {error && <p className="text-sm text-destructive">{error}</p>}
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
