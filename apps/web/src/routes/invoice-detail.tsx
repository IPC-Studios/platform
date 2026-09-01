import { useQuery } from '@tanstack/react-query'
import { Link, useParams } from '@tanstack/react-router'
import { Printer, ArrowLeft } from 'lucide-react'
import { amountInWords } from '@ipc/domain'
import { companyProfile } from '@ipc/contracts'
import { callApi } from '@/shared/api/client'
import { AuthedPage } from '@/shared/layout/AuthedPage'
import { Button } from '@/shared/ui/button'
import { SkeletonCards } from '@/shared/ui/skeleton'
import { StatusBadge } from '@/shared/ui/status-badge'
import { ErrorState } from '@/shared/ui/states'
import { formatINR, humanize } from '@/shared/ui/format'
import { useInvoice } from '@/features/billing/api'

const TONE = { draft: 'neutral', sent: 'info', partial: 'warning', paid: 'success', cancelled: 'danger' } as const

export function InvoiceDetailPage() {
  return (
    <AuthedPage module="billing">
      <InvoiceDoc />
    </AuthedPage>
  )
}

function InvoiceDoc() {
  const { id } = useParams({ from: '/billing/invoices/$id' })
  const { data, isLoading, isError, refetch } = useInvoice(id)
  const { data: company } = useQuery({
    queryKey: ['settings', 'company'],
    queryFn: () => callApi('/settings/company', { responseSchema: companyProfile }),
  })

  if (isLoading) return <SkeletonCards count={3} />
  if (isError || !data) return <ErrorState onRetry={() => void refetch()} />

  const intraState = data.items.some((i) => i.cgst > 0 || i.sgst > 0)

  return (
    <>
      <div className="no-print mb-4 flex items-center justify-between">
        <Button asChild variant="outline" size="sm">
          <Link to="/billing">
            <ArrowLeft /> Back
          </Link>
        </Button>
        <Button size="sm" onClick={() => window.print()}>
          <Printer /> Print / Save PDF
        </Button>
      </div>

      <div className="mx-auto max-w-3xl rounded-lg border border-border bg-card p-8 print:border-0 print:p-0">
        {/* Header */}
        <div className="flex items-start justify-between gap-4 border-b border-border pb-4">
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
          </div>
          <div className="text-right">
            <p className="text-lg font-semibold">TAX INVOICE</p>
            <p className="text-sm">{data.invoice_number}</p>
            <p className="text-sm text-muted-foreground">{data.invoice_date}</p>
            <StatusBadge tone={TONE[data.status]}>{humanize(data.status)}</StatusBadge>
          </div>
        </div>

        {/* Bill to */}
        <div className="py-4">
          <p className="text-xs uppercase tracking-wide text-muted-foreground">Bill to</p>
          <p className="font-medium">{data.client_name ?? '—'}</p>
        </div>

        {/* Items */}
        <table className="w-full text-sm">
          <thead className="border-y border-border text-left text-muted-foreground">
            <tr>
              <th className="py-2 font-medium">Description</th>
              <th className="py-2 text-right font-medium">Qty</th>
              <th className="py-2 text-right font-medium">Rate</th>
              <th className="py-2 text-right font-medium">GST%</th>
              {intraState ? (
                <>
                  <th className="py-2 text-right font-medium">CGST</th>
                  <th className="py-2 text-right font-medium">SGST</th>
                </>
              ) : (
                <th className="py-2 text-right font-medium">IGST</th>
              )}
              <th className="py-2 text-right font-medium">Amount</th>
            </tr>
          </thead>
          <tbody>
            {data.items.map((it) => (
              <tr key={it.id} className="border-b border-border">
                <td className="py-2">{it.description}</td>
                <td className="py-2 text-right">{it.quantity}</td>
                <td className="py-2 text-right">{formatINR(it.rate)}</td>
                <td className="py-2 text-right">{it.gst_rate}%</td>
                {intraState ? (
                  <>
                    <td className="py-2 text-right">{formatINR(it.cgst)}</td>
                    <td className="py-2 text-right">{formatINR(it.sgst)}</td>
                  </>
                ) : (
                  <td className="py-2 text-right">{formatINR(it.igst)}</td>
                )}
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
            <Row label="Taxable" value={formatINR(data.taxable)} />
            <Row label="Tax" value={formatINR(data.tax)} />
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
      </div>
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
