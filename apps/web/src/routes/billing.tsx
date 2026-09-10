import { useState, type FormEvent } from 'react'
import { Link } from '@tanstack/react-router'
import { Plus, IndianRupee } from 'lucide-react'
import { AuthedPage } from '@/shared/layout/AuthedPage'
import { PageHeader } from '@/shared/layout/page-header'
import { Button } from '@/shared/ui/button'
import { SkeletonList } from '@/shared/ui/skeleton'
import { Dialog, DialogClose, DialogContent, DialogTrigger } from '@/shared/ui/dialog'
import { Input, Label } from '@/shared/ui/input'
import { StatusBadge } from '@/shared/ui/status-badge'
import { ErrorState, EmptyState } from '@/shared/ui/states'
import { RecordCard, RecordCards } from '@/shared/ui/record-card'
import { useIsMobile } from '@/shared/hooks/use-mobile'
import { formatINR, humanize } from '@/shared/ui/format'
import { Card, CardContent } from '@/shared/ui/card'
import { BarChart, ShareChart } from '@/shared/ui/chart'
import { monthlySeries } from '@/shared/ui/chart-geometry'
import { useInvoices, useStates, useCreateInvoice, useRecordPayment } from '@/features/billing/api'
import { emptyInvoiceForm, useInvoiceForm, InvoiceFormFields } from '@/features/billing/InvoiceForm'
import { PaymentModePicker } from '@/features/settings/PaymentModePicker'

const TONE = { draft: 'neutral', sent: 'info', partial: 'warning', paid: 'success', cancelled: 'danger' } as const

export function BillingPage() {
  return (
    <AuthedPage module="billing">
      <Billing />
    </AuthedPage>
  )
}

function Billing() {
  const { data, isLoading, isError, refetch } = useInvoices()
  const isMobile = useIsMobile()

  return (
    <>
      <PageHeader title="Billing" description="GST invoices and payments." actions={<NewInvoiceDialog />} />
      {isLoading ? (
        <SkeletonList rows={5} columns={6} />
      ) : isError ? (
        <ErrorState onRetry={() => void refetch()} />
      ) : !data || data.length === 0 ? (
        <EmptyState title="No invoices yet" description="Raise your first GST invoice." action={<NewInvoiceDialog />} />
      ) : (
        <>
        <div className="grid gap-4 lg:grid-cols-2">
          <Card>
            <CardContent className="p-5">
              <h2 className="font-semibold tracking-tight">Invoiced by month</h2>
              <p className="mt-0.5 text-sm text-muted-foreground">The last six months.</p>
              <BarChart
                className="mt-4"
                points={monthlySeries(data, (i) => i.invoice_date, (i) => i.total)}
                format={formatINR}
              />
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-5">
              <h2 className="font-semibold tracking-tight">Collected against outstanding</h2>
              <p className="mt-0.5 text-sm text-muted-foreground">
                Across every invoice raised, not just this month.
              </p>
              <ShareChart
                className="mt-4"
                points={[
                  {
                    label: 'Received',
                    value: data.reduce((sum, i) => sum + (i.total - i.balance_due), 0),
                  },
                  { label: 'Outstanding', value: data.reduce((sum, i) => sum + i.balance_due, 0) },
                ]}
                format={formatINR}
              />
            </CardContent>
          </Card>
        </div>

        <div className="mt-6">
        {isMobile ? (
          <RecordCards>
            {data.map((inv) => (
              <RecordCard
                key={inv.id}
                title={
                  <Link to="/billing/invoices/$id" params={{ id: inv.id }} className="hover:underline">
                    {inv.invoice_number}
                  </Link>
                }
                subtitle={`${inv.client_name ?? '—'} · ${inv.invoice_date}`}
                badge={<StatusBadge tone={TONE[inv.status]}>{humanize(inv.status)}</StatusBadge>}
                fields={[
                  { label: 'Total', value: formatINR(inv.total) },
                  { label: 'Balance', value: formatINR(inv.balance_due), strong: true },
                ]}
                actions={
                  inv.balance_due > 0 ? (
                    <PaymentDialog invoiceId={inv.id} balance={inv.balance_due} />
                  ) : undefined
                }
              />
            ))}
          </RecordCards>
        ) : (
        <div className="table-wrap rounded-lg border border-border">
          <table className="table-sticky w-full text-sm">
            <thead className="bg-muted/50 text-left text-muted-foreground">
              <tr>
                <th className="px-4 py-2 font-medium">Number</th>
                <th className="px-4 py-2 font-medium">Client</th>
                <th className="px-4 py-2 font-medium">Date</th>
                <th className="px-4 py-2 text-right font-medium">Total</th>
                <th className="px-4 py-2 text-right font-medium">Balance</th>
                <th className="px-4 py-2 font-medium">Status</th>
                <th className="px-4 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {data.map((inv) => (
                <tr key={inv.id} className="border-t border-border">
                  <td className="px-4 py-2 font-medium">
                    <Link to="/billing/invoices/$id" params={{ id: inv.id }} className="hover:underline">
                      {inv.invoice_number}
                    </Link>
                  </td>
                  <td className="px-4 py-2 text-muted-foreground">{inv.client_name ?? '—'}</td>
                  <td className="px-4 py-2 text-muted-foreground">{inv.invoice_date}</td>
                  <td className="px-4 py-2 text-right">{formatINR(inv.total)}</td>
                  <td className="px-4 py-2 text-right font-medium">{formatINR(inv.balance_due)}</td>
                  <td className="px-4 py-2">
                    <StatusBadge tone={TONE[inv.status]}>{humanize(inv.status)}</StatusBadge>
                  </td>
                  <td className="px-4 py-2 text-right">
                    {inv.balance_due > 0 && <PaymentDialog invoiceId={inv.id} balance={inv.balance_due} />}
                  </td>
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

function NewInvoiceDialog() {
  const create = useCreateInvoice()
  const { data: states } = useStates()
  const [open, setOpen] = useState(false)
  const form = useInvoiceForm(emptyInvoiceForm())
  const [error, setError] = useState<string | null>(null)

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    try {
      await create.mutateAsync(form.toRequest())
      setOpen(false)
      form.reset()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create the invoice.')
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <Plus /> New invoice
        </Button>
      </DialogTrigger>
      <DialogContent title="New invoice" description="GST is computed automatically." className="max-w-2xl">
        <form onSubmit={onSubmit} className="flex flex-col gap-3">
          <InvoiceFormFields form={form} states={states} />
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
            <Button type="submit" disabled={create.isPending || form.totals.total <= 0 || !form.values.client_id}>
              {create.isPending ? 'Creating…' : 'Create invoice'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function PaymentDialog({ invoiceId, balance }: { invoiceId: string; balance: number }) {
  const record = useRecordPayment(invoiceId)
  const [open, setOpen] = useState(false)
  const [amount, setAmount] = useState(String(balance))
  const [mode, setMode] = useState('')
  const [error, setError] = useState<string | null>(null)

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    try {
      await record.mutateAsync({ amount: Number(amount) || 0, ...(mode ? { mode } : {}) })
      setOpen(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not record payment.')
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline">
          <IndianRupee /> Record
        </Button>
      </DialogTrigger>
      <DialogContent title="Record payment" description={`Balance due ${formatINR(balance)}`}>
        <form onSubmit={onSubmit} className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <Label>Amount</Label>
            <Input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} autoFocus />
          </div>
          <PaymentModePicker value={mode} onChange={setMode} />
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
            <Button type="submit" disabled={record.isPending}>
              {record.isPending ? 'Saving…' : 'Record'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
