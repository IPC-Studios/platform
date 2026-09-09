import { useState, type FormEvent } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link, useNavigate, useParams } from '@tanstack/react-router'
import { Printer, ArrowLeft, Download, Pencil, Trash2 } from 'lucide-react'
import { amountInWords, type GstSlab } from '@ipc/domain'
import { companyProfile, type InvoiceDetail } from '@ipc/contracts'
import { callApi } from '@/shared/api/client'
import { AuthedPage } from '@/shared/layout/AuthedPage'
import { Button } from '@/shared/ui/button'
import { SkeletonCards } from '@/shared/ui/skeleton'
import { StatusBadge } from '@/shared/ui/status-badge'
import { ErrorState } from '@/shared/ui/states'
import { Dialog, DialogClose, DialogContent, DialogTrigger } from '@/shared/ui/dialog'
import { useConfirm } from '@/shared/ui/confirm'
import { formatINR, humanize } from '@/shared/ui/format'
import { useInvoice, useUpdateInvoice, useDeleteInvoice, useStates } from '@/features/billing/api'
import { useInvoiceForm, InvoiceFormFields } from '@/features/billing/InvoiceForm'

const TONE = { draft: 'neutral', sent: 'info', partial: 'warning', paid: 'success', cancelled: 'danger' } as const

export function InvoiceDetailPage() {
  return (
    <AuthedPage module="billing">
      <InvoiceDoc />
    </AuthedPage>
  )
}

function InvoiceDoc() {
  const { id } = useParams({ from: '/authed/billing/invoices/$id' })
  const { data, isLoading, isError, refetch } = useInvoice(id)
  const { data: company } = useQuery({
    queryKey: ['settings', 'company'],
    queryFn: () => callApi('/settings/company', { responseSchema: companyProfile }),
  })

  if (isLoading) return <SkeletonCards count={3} />
  if (isError || !data) return <ErrorState onRetry={() => void refetch()} />

  const intraState = data.intra_state
  const editable = data.amount_paid === 0 && data.status !== 'cancelled'
  // No template resolved (none picked, no company default) prints exactly as
  // it always did — every layout field defaults to "show it".
  const layout = data.template_layout ?? {
    show_header: true,
    show_footer: true,
    show_gst: true,
    show_bank_details: false,
    header_text: null,
    footer_text: null,
    bank_details: null,
    terms_and_conditions: null,
  }

  return (
    <>
      <div className="no-print mb-4 flex items-center justify-between">
        <Button asChild variant="outline" size="sm">
          <Link to="/billing">
            <ArrowLeft /> Back
          </Link>
        </Button>
        <div className="flex gap-2">
          {editable && (
            <>
              <EditInvoiceDialog invoice={data} />
              <DeleteInvoiceButton invoiceId={data.id} />
            </>
          )}
          <Button size="sm" variant="outline" onClick={() => window.print()}>
            <Download /> Download PDF
          </Button>
          <Button size="sm" onClick={() => window.print()}>
            <Printer /> Print Invoice
          </Button>
        </div>
      </div>

      <div className="print-invoice mx-auto max-w-3xl rounded-lg border border-border bg-card p-8 print:border-0 print:p-0">
        {/* Header */}
        <div className="flex items-start justify-between gap-4 border-b border-border pb-4">
          {layout.show_header ? (
            <div>
              <h1 className="text-xl font-bold">{company?.name ?? 'Your Studio'}</h1>
              {company?.city && (
                <p className="text-sm text-muted-foreground">
                  {[company.city, company.state, company.country].filter(Boolean).join(', ')}
                </p>
              )}
              {company?.invoice_gst_number && (
                <p className="text-sm text-muted-foreground">GSTIN: {company.invoice_gst_number}</p>
              )}
              {layout.header_text && <p className="mt-1 text-sm text-muted-foreground">{layout.header_text}</p>}
            </div>
          ) : (
            <div />
          )}
          <div className="text-right">
            <p className="text-lg font-semibold">TAX INVOICE</p>
            <p className="text-sm">{data.invoice_number}</p>
            <p className="text-sm text-muted-foreground">{data.invoice_date}</p>
            {data.due_date && <p className="text-xs text-muted-foreground">Due {data.due_date}</p>}
            <StatusBadge tone={TONE[data.status]}>{humanize(data.status)}</StatusBadge>
          </div>
        </div>

        {/* Bill to */}
        <div className="py-4">
          <p className="text-xs uppercase tracking-wide text-muted-foreground">Bill to</p>
          <p className="font-medium">{data.client_name ?? '—'}</p>
          {data.client_address && <p className="text-sm text-muted-foreground">{data.client_address}</p>}
          {data.client_gstin && <p className="text-sm text-muted-foreground">GSTIN {data.client_gstin}</p>}
        </div>

        {/* Items */}
        <table className="w-full text-sm">
          <thead className="border-y border-border text-left text-muted-foreground">
            <tr>
              <th className="py-2 font-medium">Description</th>
              <th className="py-2 text-right font-medium">Qty</th>
              <th className="py-2 text-right font-medium">Rate</th>
              {layout.show_gst && <th className="py-2 text-right font-medium">GST%</th>}
              {layout.show_gst &&
                (intraState ? (
                  <>
                    <th className="py-2 text-right font-medium">CGST</th>
                    <th className="py-2 text-right font-medium">SGST</th>
                  </>
                ) : (
                  <th className="py-2 text-right font-medium">IGST</th>
                ))}
              <th className="py-2 text-right font-medium">Amount</th>
            </tr>
          </thead>
          <tbody>
            {data.items.map((it) => (
              <tr key={it.id} className="border-b border-border">
                <td className="py-2">
                  {it.description}
                  {it.subtext && <p className="text-xs text-muted-foreground">{it.subtext}</p>}
                </td>
                <td className="py-2 text-right">{it.quantity}</td>
                <td className="py-2 text-right">{formatINR(it.rate)}</td>
                {layout.show_gst && <td className="py-2 text-right">{it.gst_rate}%</td>}
                {layout.show_gst &&
                  (intraState ? (
                    <>
                      <td className="py-2 text-right">{formatINR(it.cgst)}</td>
                      <td className="py-2 text-right">{formatINR(it.sgst)}</td>
                    </>
                  ) : (
                    <td className="py-2 text-right">{formatINR(it.igst)}</td>
                  ))}
                <td className="py-2 text-right">{formatINR(it.amount)}</td>
              </tr>
            ))}
          </tbody>
        </table>

        {/* Totals */}
        <div className="mt-4 flex justify-end">
          <div className="w-64 space-y-1 text-sm">
            <Row label="Subtotal" value={formatINR(data.subtotal)} />
            {data.discount > 0 && <Row label="Discount" value={`− ${formatINR(data.discount)}`} />}
            {layout.show_gst && <Row label="Taxable" value={formatINR(data.taxable)} />}
            {layout.show_gst && <Row label="Tax" value={formatINR(data.tax)} />}
            <div className="my-1 border-t border-border" />
            <Row label="Total" value={formatINR(data.total)} strong />
            <Row label="Paid" value={formatINR(data.amount_paid)} />
            <Row label="Balance due" value={formatINR(data.balance_due)} strong />
          </div>
        </div>

        <p className="mt-4 border-t border-border pt-3 text-sm">
          <span className="text-muted-foreground">Amount in words: </span>
          {amountInWords(data.total)} only
        </p>

        {data.notes && (
          <p className="mt-3 whitespace-pre-line text-sm text-muted-foreground">{data.notes}</p>
        )}

        {layout.show_footer && (
          <div className="mt-4 flex flex-col gap-3 border-t border-border pt-3 text-sm">
            {layout.show_bank_details && layout.bank_details && (
              <div>
                <p className="text-xs uppercase tracking-wide text-muted-foreground">Bank details</p>
                <p className="whitespace-pre-line">{layout.bank_details}</p>
              </div>
            )}
            {layout.terms_and_conditions && (
              <div>
                <p className="text-xs uppercase tracking-wide text-muted-foreground">Terms &amp; conditions</p>
                <p className="whitespace-pre-line text-muted-foreground">{layout.terms_and_conditions}</p>
              </div>
            )}
            {layout.footer_text && <p className="text-center text-xs text-muted-foreground">{layout.footer_text}</p>}
          </div>
        )}
      </div>

      {/* Print styles */}
      <style dangerouslySetInnerHTML={{ __html: printStyles }} />
    </>
  )
}

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-muted-foreground">{label}</span>
      <span className={strong ? 'text-base font-semibold' : 'font-medium'}>{value}</span>
    </div>
  )
}

function EditInvoiceDialog({ invoice }: { invoice: InvoiceDetail }) {
  const update = useUpdateInvoice(invoice.id)
  const { data: states } = useStates()
  const [open, setOpen] = useState(false)
  const form = useInvoiceForm({
    client_id: invoice.client_id ?? '',
    project_id: invoice.project_id ?? '',
    place_of_supply: invoice.place_of_supply ?? '27',
    intra_state: invoice.intra_state,
    invoice_date: invoice.invoice_date,
    due_date: invoice.due_date ?? '',
    // Re-editing always works off the flat rupee figure it was saved as -- a percent
    // entry is not remembered as a percent once the invoice is created.
    discount: invoice.discount,
    discount_type: 'flat',
    notes: invoice.notes ?? '',
    template_id: invoice.template_id ?? '',
    invoice_number: '',
    lines: invoice.items.map((i) => ({
      description: i.description,
      subtext: i.subtext ?? undefined,
      quantity: i.quantity,
      rate: i.rate,
      gst_rate: i.gst_rate as GstSlab,
    })),
  })
  const [error, setError] = useState<string | null>(null)

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    try {
      await update.mutateAsync(form.toRequest())
      setOpen(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not update the invoice.')
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline">
          <Pencil /> Edit
        </Button>
      </DialogTrigger>
      <DialogContent
        title="Edit invoice"
        description="No payment is recorded yet, so the whole invoice can still be corrected."
        className="max-w-2xl"
      >
        <form onSubmit={onSubmit} className="flex flex-col gap-3">
          <InvoiceFormFields form={form} states={states} isEdit />
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
            <Button type="submit" disabled={update.isPending || form.totals.total <= 0 || !form.values.client_id}>
              {update.isPending ? 'Saving…' : 'Save changes'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function DeleteInvoiceButton({ invoiceId }: { invoiceId: string }) {
  const del = useDeleteInvoice()
  const confirm = useConfirm()
  const navigate = useNavigate()

  async function onDelete() {
    const yes = await confirm({
      title: 'Delete this invoice?',
      description: 'No payment has been recorded against it yet. This cannot be undone.',
      destructive: true,
      confirmLabel: 'Delete',
    })
    if (!yes) return
    await del.mutateAsync(invoiceId)
    void navigate({ to: '/billing' })
  }

  return (
    <Button size="sm" variant="outline" onClick={() => void onDelete()} disabled={del.isPending}>
      <Trash2 /> Delete
    </Button>
  )
}

// Print-optimized styles
const printStyles = `
  @media print {
    body * { visibility: hidden; }
    .print-invoice, .print-invoice * { visibility: visible; }
    .print-invoice { position: absolute; left: 0; top: 0; width: 100%; }
    .no-print { display: none !important; }
    @page { margin: 1cm; size: A4; }
  }
`
