import { useMemo, useState, type FormEvent } from 'react'
import { Plus, Trash2, IndianRupee } from 'lucide-react'
import { computeInvoice, type GstSlab } from '@ipc/domain'
import type { CreateInvoiceRequest, InvoiceLineInput } from '@ipc/contracts'
import { AuthedPage } from '@/shared/layout/AuthedPage'
import { PageHeader } from '@/shared/layout/page-header'
import { Button } from '@/shared/ui/button'
import { Dialog, DialogClose, DialogContent, DialogTrigger } from '@/shared/ui/dialog'
import { Input, Label, Select } from '@/shared/ui/input'
import { StatusBadge } from '@/shared/ui/status-badge'
import { LoadingState, ErrorState, EmptyState } from '@/shared/ui/states'
import { formatINR, humanize } from '@/shared/ui/format'
import { useInvoices, useStates, useCreateInvoice, useRecordPayment } from '@/features/billing/api'

const TONE = { draft: 'neutral', sent: 'info', partial: 'warning', paid: 'success', cancelled: 'danger' } as const
const GST_SLABS: GstSlab[] = [0, 5, 12, 18, 28]

export function BillingPage() {
  return (
    <AuthedPage module="billing">
      <Billing />
    </AuthedPage>
  )
}

function Billing() {
  const { data, isLoading, isError, refetch } = useInvoices()

  return (
    <>
      <PageHeader title="Billing" description="GST invoices and payments." actions={<NewInvoiceDialog />} />
      {isLoading ? (
        <LoadingState />
      ) : isError ? (
        <ErrorState onRetry={() => void refetch()} />
      ) : !data || data.length === 0 ? (
        <EmptyState title="No invoices yet" description="Raise your first GST invoice." action={<NewInvoiceDialog />} />
      ) : (
        <div className="overflow-hidden rounded-lg border border-border">
          <table className="w-full text-sm">
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
                  <td className="px-4 py-2 font-medium">{inv.invoice_number}</td>
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
    </>
  )
}

type Line = InvoiceLineInput

function NewInvoiceDialog() {
  const create = useCreateInvoice()
  const { data: states } = useStates()
  const [open, setOpen] = useState(false)
  const [place, setPlace] = useState('27')
  const [intra, setIntra] = useState(true)
  const [discount, setDiscount] = useState(0)
  const [lines, setLines] = useState<Line[]>([{ description: '', quantity: 1, rate: 0, gst_rate: 18 }])
  const [error, setError] = useState<string | null>(null)

  const totals = useMemo(
    () =>
      computeInvoice(
        lines.filter((l) => l.description.trim()).map((l) => ({ ...l, gst_rate: l.gst_rate as GstSlab })),
        { intraState: intra, discount },
      ),
    [lines, intra, discount],
  )

  function patch(i: number, p: Partial<Line>) {
    setLines((ls) => ls.map((l, idx) => (idx === i ? { ...l, ...p } : l)))
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    try {
      const body: CreateInvoiceRequest = {
        client_id: null,
        project_id: null,
        place_of_supply: place,
        intra_state: intra,
        discount,
        lines: lines.filter((l) => l.description.trim()),
      }
      await create.mutateAsync(body)
      setOpen(false)
      setLines([{ description: '', quantity: 1, rate: 0, gst_rate: 18 }])
      setDiscount(0)
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
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <Label>Place of supply</Label>
              <Select value={place} onChange={(e) => setPlace(e.target.value)}>
                {(states ?? []).map((s) => (
                  <option key={s.code} value={s.code}>
                    {s.name}
                  </option>
                ))}
              </Select>
            </div>
            <label className="mt-6 flex items-center gap-2 text-sm">
              <input type="checkbox" checked={intra} onChange={(e) => setIntra(e.target.checked)} />
              Same state as studio (CGST + SGST)
            </label>
          </div>

          <div className="rounded-md border border-border">
            {lines.map((l, i) => (
              <div key={i} className="flex flex-wrap items-center gap-2 border-b border-border p-2 last:border-0">
                <Input placeholder="Description" value={l.description} onChange={(e) => patch(i, { description: e.target.value })} className="min-w-40 flex-1" />
                <Input type="number" min={0} value={l.quantity} onChange={(e) => patch(i, { quantity: Number(e.target.value) })} className="w-16" />
                <Input type="number" min={0} value={l.rate} onChange={(e) => patch(i, { rate: Number(e.target.value) })} className="w-28" placeholder="Rate" />
                <Select value={l.gst_rate} onChange={(e) => patch(i, { gst_rate: Number(e.target.value) as GstSlab })} className="w-20">
                  {GST_SLABS.map((g) => (
                    <option key={g} value={g}>
                      {g}%
                    </option>
                  ))}
                </Select>
                <Button type="button" variant="ghost" size="icon" onClick={() => setLines((ls) => ls.filter((_, idx) => idx !== i))}>
                  <Trash2 />
                </Button>
              </div>
            ))}
            <div className="p-2">
              <Button type="button" variant="outline" size="sm" onClick={() => setLines((ls) => [...ls, { description: '', quantity: 1, rate: 0, gst_rate: 18 }])}>
                <Plus /> Add line
              </Button>
            </div>
          </div>

          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <Label>Discount ₹</Label>
              <Input type="number" min={0} value={discount} onChange={(e) => setDiscount(Number(e.target.value))} className="w-32" />
            </div>
            <div className="text-right text-sm">
              <p className="text-muted-foreground">
                Subtotal {formatINR(totals.subtotal)} · Tax {formatINR(totals.tax)}
              </p>
              <p className="text-lg font-semibold">{formatINR(totals.total)}</p>
            </div>
          </div>

          {error && <p className="text-sm text-destructive">{error}</p>}
          <div className="flex justify-end gap-2">
            <DialogClose asChild>
              <Button type="button" variant="outline">
                Cancel
              </Button>
            </DialogClose>
            <Button type="submit" disabled={create.isPending || totals.total <= 0}>
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
  const [amount, setAmount] = useState(balance)
  const [mode, setMode] = useState('upi')
  const [error, setError] = useState<string | null>(null)

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    try {
      await record.mutateAsync({ amount, mode })
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
            <Input type="number" min={0} value={amount} onChange={(e) => setAmount(Number(e.target.value))} autoFocus />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>Mode</Label>
            <Input value={mode} onChange={(e) => setMode(e.target.value)} placeholder="upi / cash / bank" />
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
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
