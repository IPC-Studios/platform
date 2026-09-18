import { Printer } from 'lucide-react'
import type { CrmQuote } from '@ipc/contracts'
import { Button } from '@/shared/ui/button'
import { Dialog, DialogContent } from '@/shared/ui/dialog'
import { StatusBadge } from '@/shared/ui/status-badge'
import { DownloadDocumentButton } from '@/shared/ui/download-document'
import { formatINR } from '@/shared/ui/format'

/**
 * Read a quote in the app, the way the client sees it.
 *
 * The quotes list could send a quote four ways — link, WhatsApp, email, mark
 * accepted — and open it none. To check what a number actually covered, the
 * studio had to copy the client's own accept link and open the page with the
 * Accept and Decline buttons on it, which is a genuinely bad place to be
 * clicking around in.
 *
 * Everything here is already in the row: the list endpoint returns each
 * quote's line items with it. So this is a reader, not a fetch — it opens
 * instantly and works for a draft that has never been sent.
 */
export function QuoteViewer({ quote, onClose }: { quote: CrmQuote | null; onClose: () => void }) {
  if (!quote) return null

  const dayFormat = new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })
  const tone =
    quote.status === 'accepted'
      ? 'success'
      : quote.status === 'declined'
        ? 'danger'
        : quote.status === 'expired'
          ? 'warning'
          : 'neutral'

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose() }}>
      <DialogContent
        title={`${quote.quote_number}${quote.title ? ` · ${quote.title}` : ''}`}
        description={[quote.lead_name, quote.valid_until ? `Valid till ${dayFormat.format(new Date(quote.valid_until))}` : null]
          .filter(Boolean)
          .join(' · ') || 'Quotation'}
        className="max-w-2xl"
      >
        <div className="flex max-h-[75vh] flex-col gap-4 overflow-y-auto pr-1">
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge tone={tone}>{quote.status}</StatusBadge>
            {quote.sent_at && (
              <span className="text-xs text-muted-foreground">
                Sent {dayFormat.format(new Date(quote.sent_at))}
              </span>
            )}
          </div>

          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full text-sm">
              <thead className="bg-muted/40 text-left">
                <tr>
                  <th className="px-3 py-2 font-medium">Description</th>
                  <th className="px-3 py-2 text-right font-medium">Qty</th>
                  <th className="px-3 py-2 text-right font-medium">Rate</th>
                  <th className="px-3 py-2 text-right font-medium">Amount</th>
                </tr>
              </thead>
              <tbody>
                {quote.items.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="px-3 py-4 text-center text-sm text-muted-foreground">
                      This quote has no line items.
                    </td>
                  </tr>
                ) : (
                  quote.items.map((i) => (
                    <tr key={i.id} className="border-t border-border">
                      <td className="px-3 py-2">{i.description}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{i.quantity}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{formatINR(i.rate)}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{formatINR(i.amount)}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          <dl className="ml-auto w-full max-w-xs text-sm">
            <Row label="Subtotal" value={formatINR(quote.subtotal)} />
            {quote.discount > 0 && <Row label="Discount" value={`− ${formatINR(quote.discount)}`} />}
            {quote.tax > 0 && (
              <Row
                label={quote.intra_state ? 'GST (CGST + SGST)' : 'GST (IGST)'}
                value={formatINR(quote.tax)}
              />
            )}
            <div className="mt-1 flex items-center justify-between border-t border-border pt-2 font-semibold">
              <dt>Total</dt>
              <dd className="tabular-nums">{formatINR(quote.total)}</dd>
            </div>
          </dl>

          {quote.notes && (
            <section>
              <p className="text-sm font-semibold">Notes</p>
              <p className="mt-1 whitespace-pre-wrap text-sm text-muted-foreground">{quote.notes}</p>
            </section>
          )}
          {quote.terms && (
            <section>
              <p className="text-sm font-semibold">Terms</p>
              <p className="mt-1 whitespace-pre-wrap text-sm text-muted-foreground">{quote.terms}</p>
            </section>
          )}

          {/* The client's own answer, which is the evidence for the booking. */}
          {quote.accepted_at && (
            <p className="rounded-lg border border-success/40 bg-success/10 p-3 text-sm">
              Accepted by {quote.accepted_by_name ?? 'the client'}
              {quote.accepted_by_email ? ` (${quote.accepted_by_email})` : ''} on{' '}
              {new Date(quote.accepted_at).toLocaleString('en-IN')}
              {quote.accepted_ip ? ` from ${quote.accepted_ip}` : ''}.
            </p>
          )}
          {quote.declined_at && (
            <p className="rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm">
              Declined on {new Date(quote.declined_at).toLocaleString('en-IN')}
              {quote.decline_reason ? ` — ${quote.decline_reason}` : ''}.
            </p>
          )}

          <div className="flex justify-end gap-2 border-t border-border pt-3">
            <DownloadDocumentButton name={`${quote.quote_number}${quote.title ? ` ${quote.title}` : ''}`} />
            <Button variant="outline" size="sm" onClick={() => window.print()}>
              <Printer className="mr-1 size-4" /> Print
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between py-0.5">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="tabular-nums">{value}</dd>
    </div>
  )
}
