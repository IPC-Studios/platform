import { useEffect, useState } from 'react'
import { publicQuotation, z, type PublicQuotation } from '@ipc/contracts'
import { CheckCircle2, FileText } from 'lucide-react'
import { callApi, ApiError } from '@/shared/api/client'
import { CameraBackdrop } from '@/shared/brand/CameraBackdrop'
import { Button } from '@/shared/ui/button'
import { Card, CardContent } from '@/shared/ui/card'
import { Input, Label } from '@/shared/ui/input'
import { Skeleton } from '@/shared/ui/skeleton'
import { formatINR } from '@/shared/ui/format'

const okResponse = z.object({ ok: z.boolean() })

/**
 * PUBLIC page — no auth, no app shell.
 *
 * What the couple sees when the studio sends "here's the quote". The numbers
 * come from the snapshot taken when it was issued, so the page cannot quietly
 * disagree with the paper they were shown.
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

  return (
    <div className="relative overflow-hidden">
      <CameraBackdrop />
      <div className="relative mx-auto flex min-h-screen max-w-2xl flex-col justify-center gap-4 p-4">
        <div className="flex items-center gap-2">
          <span className="flex size-9 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            <FileText className="size-5" />
          </span>
          <div>
            <p className="font-semibold leading-tight">{quote?.company_name ?? 'Quotation'}</p>
            <p className="text-sm text-muted-foreground">
              {quote?.snapshot.project_name ?? 'Your project'}
              {quote?.client_name ? ` · ${quote.client_name}` : ''}
            </p>
          </div>
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
                </dl>

                {quote.notes && (
                  <p className="mt-4 rounded-lg border border-border bg-muted/30 p-3 text-sm">
                    {quote.notes}
                  </p>
                )}

                {answered === 'accepted' ? (
                  <p className="mt-5 flex items-center gap-2 rounded-lg bg-success/10 p-3 text-sm font-medium text-success">
                    <CheckCircle2 className="size-4 shrink-0" />
                    Accepted{name ? ` by ${name}` : ''} — the studio has been told.
                  </p>
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
