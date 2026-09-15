import { useEffect, useState } from 'react'
import { publicQuotation, z, parseQuotationTerms, buildMailtoUrl, buildWhatsAppUrl, type PublicQuotation } from '@ipc/contracts'
import { CheckCircle2, FileText, Printer, Mail, MessageCircle, Copy } from 'lucide-react'
import { toast } from 'sonner'
import { callApi, ApiError } from '@/shared/api/client'
import { CameraBackdrop } from '@/shared/brand/CameraBackdrop'
import { Button } from '@/shared/ui/button'
import { Card, CardContent } from '@/shared/ui/card'
import { Input, Label } from '@/shared/ui/input'
import { Skeleton } from '@/shared/ui/skeleton'
import { StatusBadge } from '@/shared/ui/status-badge'
import { formatINR } from '@/shared/ui/format'

const okResponse = z.object({ ok: z.boolean() })
const emailResult = z.object({ status: z.string(), error: z.string().nullable(), url: z.string() })

/**
 * PUBLIC page — no auth, no app shell.
 *
 * What the couple sees when the studio sends "here's the quote". The numbers
 * come from the snapshot taken when it was issued, so the page cannot quietly
 * disagree with the paper they were shown.
 *
 * Lovable parity: branding header, shoots schedule, received/balance, terms,
 * display prefs (8), Print, answered state, expiry gate, show_quotation gate.
 * NOTE: quote-accept.tsx keeps the separate GST checkout flow — this page is
 * the read-only snapshot + accept/decline only.
 */
export function QuotationPage() {
  const token = new URLSearchParams(window.location.search).get('token') ?? ''
  const [quote, setQuote] = useState<PublicQuotation | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [answered, setAnswered] = useState<'accepted' | 'declined' | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!token) {
      setLoadError('This link is missing its token.')
      return
    }
    callApi(`/public/quotation/${token}`, { responseSchema: publicQuotation })
      .then((q) => {
        if (q.show_quotation === false) {
          setLoadError('This quotation is currently hidden by the studio. Please ask them for an updated link.')
          return
        }
        if (q.revoked) {
          setLoadError('This link has been revoked. Please ask the studio for a fresh one.')
          return
        }
        if (q.expires_at && new Date(q.expires_at).getTime() < Date.now()) {
          setLoadError('This quotation has expired. Please ask the studio for a fresh one.')
          return
        }
        setQuote(q)
        setName(q.accepted_by_name ?? q.client_name ?? '')
        if (q.accepted_at) setAnswered('accepted')
        else if (q.declined_at) setAnswered('declined')
      })
      .catch((e) =>
        setLoadError(e instanceof Error ? e.message : 'This link is invalid or has expired.'),
      )
  }, [token])

  async function respond(accept: boolean) {
    setError(null)
    setBusy(true)
    try {
      await callApi(`/public/quotation/${token}/respond`, {
        method: 'POST',
        body: { accept, name: accept ? name.trim() : null },
        responseSchema: okResponse,
      })
      setAnswered(accept ? 'accepted' : 'declined')
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not record your answer.')
    } finally {
      setBusy(false)
    }
  }

  const prefs = (quote?.display_prefs ?? {}) as Record<string, boolean>
  // Lovable parity: 8 display prefs (camelCase) with legacy snake_case fallback.
  const showPref = (camel: string, snake: string, fallback = true) => {
    if (typeof prefs[camel] === 'boolean') return prefs[camel]
    return show(snake, fallback)
  }
  const show = (key: string, fallback = true) => (typeof prefs[key] === 'boolean' ? prefs[key] : fallback)
  // Fixed received/balance: server-provided totals win; otherwise derive from
  // the snapshot so the page can never claim received == total - total (0).
  const total = quote?.snapshot.total ?? 0
  const received = Math.max(0, quote?.total_received ?? 0)
  const balance = Math.max(0, quote?.balance_due ?? total - received)
  const terms = parseQuotationTerms(quote?.terms_text ?? null)
  const shoots = Array.isArray(quote?.shoots_schedule) ? (quote?.shoots_schedule as Record<string, unknown>[]) : []
  const deliverables2 = Array.isArray(quote?.deliverables_2) ? (quote?.deliverables_2 as Record<string, unknown>[]) : []
  const url = typeof window !== 'undefined' ? window.location.href : ''
  const shareText = quote ? `Hi, here is your quotation for ${quote.snapshot.project_name} (${formatINR(total)}): ${url}` : url

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(url)
      toast.success('Quotation link copied.')
    } catch {
      toast.error('Could not copy the link.')
    }
  }

  /** Lovable parity: server send — emails the quotation from the studio. */
  async function serverSend() {
    const qid = quote?.quotation_id
    if (!qid) {
      toast.message('Email provider not configured — use Email app below.')
      window.location.href = buildMailtoUrl(null, `Quotation — ${quote?.snapshot.project_name ?? ''}`, shareText)
      return
    }
    setBusy(true)
    try {
      const r = await callApi(`/documents/quotations/${qid}/send-email`, {
        method: 'POST',
        body: {},
        responseSchema: emailResult,
      })
      if (r.status === 'sent') toast.success('Quotation emailed successfully.')
      else if (r.status === 'provider_missing') {
        window.location.href = buildMailtoUrl(null, `Quotation — ${quote?.snapshot.project_name ?? ''}`, shareText)
        toast.message('Email provider not configured — opened your email client.')
      } else toast.error(r.error ?? 'Email failed to send.')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Email failed to send.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="relative overflow-hidden">
      <CameraBackdrop />
      <div className="paper relative mx-auto flex min-h-screen max-w-2xl flex-col justify-center gap-4 p-4">
        <div className="flex items-center gap-2">
          {quote?.logo_url ? (
            <img src={quote.logo_url} alt={quote.company_name ?? 'Studio logo'} className="size-9 rounded-lg object-contain" />
          ) : (
            <span className="flex size-9 items-center justify-center rounded-lg bg-primary text-primary-foreground">
              <FileText className="size-5" />
            </span>
          )}
          <div>
            <p className="font-semibold leading-tight">{quote?.company_name ?? 'Quotation'}</p>
            <p className="text-sm text-muted-foreground">
              {quote?.snapshot.project_name ?? 'Your project'}
              {quote?.client_name ? ` · ${quote.client_name}` : ''}
            </p>
            {(quote?.company_phone || quote?.company_email) && (
              <p className="text-xs text-muted-foreground">
                {[quote.company_phone, quote.company_email].filter(Boolean).join(' · ')}
              </p>
            )}
          </div>
          {answered === 'accepted' && <StatusBadge tone="success">Accepted</StatusBadge>}
          {answered === 'declined' && <StatusBadge tone="warning">Declined</StatusBadge>}
        </div>

        <Card>
          <CardContent className="p-5 sm:p-6">
            {loadError ? (
              <p className="text-sm text-destructive">{loadError}</p>
            ) : !quote ? (
              <div className="flex flex-col gap-2">
                <Skeleton className="h-4 w-2/3" />
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-4 w-1/2" />
              </div>
            ) : (
              <>
                <ul className="divide-y divide-border">
                  {quote.snapshot.items.map((item, i) => (
                    <li key={i} className="flex items-center justify-between gap-4 py-2.5 text-sm">
                      <span className="min-w-0 flex-1">{item.title}</span>
                      <span className="shrink-0 tabular-nums text-muted-foreground">
                        {item.chargeable ? formatINR(item.amount) : 'Included'}
                      </span>
                    </li>
                  ))}
                </ul>

                <dl className="mt-4 flex flex-col gap-1.5 border-t border-border pt-4 text-sm">
                  <Row label="Package" value={formatINR(quote.snapshot.package_cost)} />
                  {quote.snapshot.add_ons > 0 && (
                    <Row label="Add-ons" value={formatINR(quote.snapshot.add_ons)} />
                  )}
                  <Row label="Total" value={formatINR(quote.snapshot.total)} strong />
                  {(showPref('showCostSummary', 'cost') || received > 0 || balance !== total) && (
                    <>
                      <Row label="Received" value={formatINR(received)} />
                      <Row label="Balance" value={formatINR(balance)} strong />
                    </>
                  )}
                </dl>

                {deliverables2.length > 0 && showPref('showDeliverables', 'deliverables') && (
                  <div className="mt-4">
                    <h3 className="text-sm font-semibold">Additional deliverables</h3>
                    <ul className="mt-1.5 flex flex-col gap-1.5 text-sm text-muted-foreground">
                      {deliverables2.map((d, i) => (
                        <li key={i} className="flex items-center justify-between gap-4 rounded-lg border border-border bg-muted/20 px-3 py-2">
                          <span>{String(d['title'] ?? `Item ${i + 1}`)}</span>
                          {d['amount'] != null || d['additional_charge_amount'] != null ? (
                            <span className="tabular-nums">{formatINR(Number(d['amount'] ?? d['additional_charge_amount']) || 0)}</span>
                          ) : null}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {(showPref('showEventSchedule', 'shoots') || show('shoots')) && shoots.length > 0 && (
                  <div className="mt-4">
                    <h3 className="text-sm font-semibold">Shoot schedule</h3>
                    <ul className="mt-1.5 flex flex-col gap-1.5 text-sm text-muted-foreground">
                      {shoots.map((s, i) => {
                        const services = Array.isArray(s['services']) ? (s['services'] as Array<Record<string, unknown>>) : []
                        const showServices = showPref('showShootServices', 'services')
                        return (
                          <li key={i} className="rounded-lg border border-border bg-muted/20 px-3 py-2">
                            {String(s['date'] ?? s['title'] ?? `Shoot ${i + 1}`)}
                            {s['location'] ? ` · ${String(s['location'])}` : ''}
                            {s['city'] ? ` · ${String(s['city'])}` : ''}
                            {showServices && services.length > 0 && (
                              <span className="mt-0.5 block text-xs">
                                {services.map((sv) => `${String(sv['name'] ?? 'Service')}${Number(sv['quantity'] ?? 1) > 1 ? ` ×${Number(sv['quantity'])}` : ''}`).join(', ')}
                              </span>
                            )}
                          </li>
                        )
                      })}
                    </ul>
                  </div>
                )}

                {(showPref('showTerms', 'terms') || show('terms')) && (
                  <div className="mt-4">
                    <h3 className="text-sm font-semibold">Terms</h3>
                    <ul className="mt-1.5 list-disc space-y-1 pl-5 text-sm text-muted-foreground">
                      {terms.map((t, i) => (
                        <li key={i}>{t}</li>
                      ))}
                    </ul>
                  </div>
                )}

                {quote.notes && show('notes') && (
                  <p className="mt-4 rounded-lg border border-border bg-muted/30 p-3 text-sm">
                    {quote.notes}
                  </p>
                )}

                {show('company') && (quote.company_address || quote.gstin) && (
                  <p className="mt-3 text-xs text-muted-foreground">
                    {[quote.company_address, quote.gstin ? `GSTIN: ${quote.gstin}` : null].filter(Boolean).join(' · ')}
                  </p>
                )}

                <Button variant="outline" className="no-print mt-4 w-full" onClick={() => window.print()}>
                  <Printer className="mr-1 size-4" /> Print
                </Button>
                <div className="no-print mt-2 flex flex-wrap gap-2">
                  <Button size="sm" variant="outline" asChild>
                    <a href={buildWhatsAppUrl(null, shareText)} target="_blank" rel="noreferrer noopener">
                      <MessageCircle className="mr-1 size-4" /> WhatsApp
                    </a>
                  </Button>
                  <Button size="sm" variant="outline" asChild>
                    <a href={buildMailtoUrl(null, `Quotation — ${formatINR(total)}`, shareText)}>
                      <Mail className="mr-1 size-4" /> Email
                    </a>
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => void copyLink()}>
                    <Copy className="mr-1 size-4" /> Copy link
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => void serverSend()} disabled={busy}>
                    Send via studio
                  </Button>
                </div>

                {answered === 'accepted' ? (
                  <div className="mt-5 rounded-lg bg-success/10 p-3 text-sm">
                    <p className="flex items-center gap-2 font-medium text-success">
                      <CheckCircle2 className="size-4 shrink-0" />
                      Accepted{name ? ` by ${name}` : ''} — the studio has been told.
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      Acknowledgement receipt{quote.accepted_at ? ` · recorded ${new Date(quote.accepted_at).toLocaleString('en-IN')}` : ''}.
                      Keep this link as your receipt.
                    </p>
                    <Button size="sm" variant="outline" className="no-print mt-2" onClick={() => window.print()}>
                      <Printer className="mr-1 size-4" /> Print receipt
                    </Button>
                  </div>
                ) : (
                  <div className="mt-5 flex flex-col gap-3">
                    {answered === 'declined' && (
                      <p className="rounded-lg border border-border p-3 text-sm text-muted-foreground">
                        You declined this quotation. You can still accept it below if you change
                        your mind.
                      </p>
                    )}
                    <div className="flex flex-col gap-1.5">
                      <Label>Your name</Label>
                      <Input
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        placeholder="Rahul Sharma"
                      />
                      <p className="text-xs text-muted-foreground">
                        Typing your name and accepting records your approval of the prices above.
                      </p>
                    </div>
                    {error && <p className="text-sm text-destructive">{error}</p>}
                    <div className="flex flex-wrap gap-2">
                      <Button
                        onClick={() => void respond(true)}
                        disabled={busy || name.trim().length < 2}
                      >
                        Accept quotation
                      </Button>
                      <Button variant="outline" onClick={() => void respond(false)} disabled={busy}>
                        Not right now
                      </Button>
                    </div>
                  </div>
                )}
              </>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <dt className={strong ? 'font-medium' : 'text-muted-foreground'}>{label}</dt>
      <dd className={strong ? 'text-base font-semibold tabular-nums' : 'tabular-nums'}>{value}</dd>
    </div>
  )
}
