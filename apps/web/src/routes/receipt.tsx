import { useEffect, useState } from 'react'
import { publicReceipt, type PublicReceipt } from '@ipc/contracts'
import { IndianRupee, Printer } from 'lucide-react'
import { callApi } from '@/shared/api/client'
import { Button } from '@/shared/ui/button'
import { Card, CardContent } from '@/shared/ui/card'
import { Skeleton } from '@/shared/ui/skeleton'
import { formatINR } from '@/shared/ui/format'

/**
 * PUBLIC page — no auth. A payment receipt, sent after money lands.
 *
 * No branding flourish and no backdrop: this is a document somebody may print
 * or forward to an accountant, so it stays plain and prints as it looks. The
 * balance is shown because "what do I still owe" is the next question every
 * client asks.
 */
export function ReceiptPage() {
  const token = new URLSearchParams(window.location.search).get('token') ?? ''
  const [receipt, setReceipt] = useState<PublicReceipt | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!token) {
      setError('This link is missing its token.')
      return
    }
    callApi(`/public/receipt/${token}`, { responseSchema: publicReceipt })
      .then(setReceipt)
      .catch((e) => setError(e instanceof Error ? e.message : 'This link is invalid or expired.'))
  }, [token])

  const balance = receipt ? Math.max(0, receipt.total_cost - receipt.received_total) : 0

  return (
    <div className="mx-auto flex min-h-screen max-w-lg flex-col justify-center gap-4 p-4">
      <Card>
        <CardContent className="p-6">
          {error ? (
            <p className="text-sm text-destructive">{error}</p>
          ) : !receipt ? (
            <div className="flex flex-col gap-2">
              <Skeleton className="h-4 w-1/2" />
              <Skeleton className="h-8 w-2/3" />
              <Skeleton className="h-4 w-full" />
            </div>
          ) : (
            <>
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    Payment received
                  </p>
                  <p className="text-lg font-semibold">{receipt.company_name}</p>
                </div>
                <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-success/10 text-success">
                  <IndianRupee className="size-5" />
                </span>
              </div>

              <p className="mt-4 text-3xl font-semibold tabular-nums">
                {formatINR(receipt.amount)}
              </p>
              <p className="text-sm text-muted-foreground">
                {receipt.paid_on}
                {receipt.mode ? ` · ${receipt.mode}` : ''}
                {receipt.reference ? ` · ${receipt.reference}` : ''}
              </p>

              <dl className="mt-5 flex flex-col gap-1.5 border-t border-border pt-4 text-sm">
                <Row label="Project" value={receipt.project_name ?? '—'} />
                <Row label="Client" value={receipt.client_name ?? '—'} />
                <Row label="Project total" value={formatINR(receipt.total_cost)} />
                <Row label="Paid so far" value={formatINR(receipt.received_total)} />
                <Row label="Balance" value={formatINR(balance)} strong />
              </dl>

              <Button
                variant="outline"
                className="mt-5 w-full no-print"
                onClick={() => window.print()}
              >
                <Printer /> Print or save as PDF
              </Button>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className={strong ? 'font-semibold tabular-nums' : 'tabular-nums'}>{value}</dd>
    </div>
  )
}
