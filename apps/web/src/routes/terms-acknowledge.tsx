import { useEffect, useState, type FormEvent } from 'react'
import { z, buildMailtoUrl, buildWhatsAppUrl } from '@ipc/contracts'
import { CheckCircle2, FileText, Printer, MessageCircle, Mail, Copy } from 'lucide-react'
import { toast } from 'sonner'
import { callApi, ApiError } from '@/shared/api/client'
import { CameraBackdrop } from '@/shared/brand/CameraBackdrop'
import { Button } from '@/shared/ui/button'
import { Card, CardContent } from '@/shared/ui/card'
import { Input, Label } from '@/shared/ui/input'
import { Skeleton } from '@/shared/ui/skeleton'
import { StatusBadge } from '@/shared/ui/status-badge'

const termsBody = z.object({ body: z.string() })
// Lovable parity: rich payload (title/project/client/company/payment/sections/expiry/status).
const paymentTerm = z.object({
  id: z.string().nullish(),
  label: z.string(),
  mode: z.string().nullish(),
  value: z.number().nullish(),
  due_trigger: z.string().nullish(),
  due_date: z.string().nullable().nullish(),
  notes: z.string().nullable().nullish(),
})
const termsPayload = z.object({
  title: z.string().nullable(),
  body: z.string(),
  project_name: z.string().nullable(),
  client_name: z.string().nullable(),
  client_phone: z.string().nullable(),
  company_name: z.string().nullable(),
  logo_url: z.string().nullable(),
  company_phone: z.string().nullable(),
  company_email: z.string().nullable(),
  company_address: z.string().nullable(),
  payment_summary: z.string().nullable(),
  sections: z.array(z.record(z.string(), z.unknown())).default([]),
  expires_at: z.string().nullable(),
  revoked: z.boolean().default(false),
  acknowledged_at: z.string().nullable(),
  acknowledged_by_name: z.string().nullable(),
  access_count: z.number().default(0),
  // Letterhead + bill-to: this is a legal document, so it has to say who issued
  // it, to whom, and when.
  company_legal_name: z.string().nullable().nullish(),
  company_website: z.string().nullable().nullish(),
  client_email: z.string().nullable().nullish(),
  client_address: z.string().nullable().nullish(),
  gstin: z.string().nullable().nullish(),
  document_number: z.string().nullable().nullish(),
  issued_at: z.string().nullable().nullish(),
  // Lovable parity round 2: structured payment table + totals + legal/footer.
  payment_terms: z.array(paymentTerm).nullish(),
  total_cost: z.number().nullish(),
  legal_note: z.string().nullable().nullish(),
  document_footer_note: z.string().nullable().nullish(),
  already_acknowledged: z.boolean().nullish(),
})
type TermsPayload = z.infer<typeof termsPayload>

/**
 * PUBLIC page — no auth. A client opens the emailed link (?token=…), reads the
 * terms, and taps "I agree". No app shell; this is the only thing they see.
 *
 * Lovable parity: rich payload header (title/project/client/company/payment),
 * sections list, Print + acked view, email/WhatsApp share, expiry/revoke
 * states. Server logs email sends to project_terms_email_logs and notifies
 * the studio on ack (best-effort).
 */
export function TermsAcknowledgePage() {
  const token = new URLSearchParams(window.location.search).get('token') ?? ''
  const [doc, setDoc] = useState<TermsPayload | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [done, setDone] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!token) {
      setLoadError('This link is missing its token.')
      return
    }
    // Rich payload first; fall back to the legacy body-only reader.
    callApi(`/public/terms/${token}/payload`, { responseSchema: termsPayload })
      .then((r) => {
        if (r.revoked) {
          setLoadError('This link has been revoked. Please ask the studio for a fresh one.')
          return
        }
        if (r.expires_at && new Date(r.expires_at).getTime() < Date.now()) {
          setLoadError('This link has expired. Please ask the studio for a fresh one.')
          return
        }
        if (r.acknowledged_at || r.already_acknowledged) {
          setDoc(r)
          setName(r.acknowledged_by_name ?? '')
          setDone(true)
          return
        }
        setDoc(r)
      })
      .catch(() =>
        callApi(`/public/terms/${token}`, { responseSchema: termsBody })
          .then((r) => setDoc({
            title: 'Terms & agreement', body: r.body, project_name: null, client_name: null,
            client_phone: null, company_name: null, logo_url: null, company_phone: null,
            company_email: null, company_address: null, payment_summary: null, sections: [],
            expires_at: null, revoked: false, acknowledged_at: null, acknowledged_by_name: null, access_count: 0,
            payment_terms: null, total_cost: null, legal_note: null, document_footer_note: null, already_acknowledged: null,
          }))
          .catch((e) => setLoadError(e instanceof Error ? e.message : 'This link is invalid or expired.')),
      )
  }, [token])

  async function onAgree(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setBusy(true)
    try {
      await callApi(`/public/terms/${token}/ack`, {
        method: 'POST',
        body: { name: name.trim(), email: email.trim() || undefined },
        responseSchema: z.object({ ok: z.boolean() }),
      })
      setDone(true)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not record your agreement.')
    } finally {
      setBusy(false)
    }
  }

  const url = typeof window !== 'undefined' ? window.location.href : ''
  const shareText = doc ? `${doc.title ?? 'Terms & agreement'}${doc.project_name ? ` for ${doc.project_name}` : ''}: ${url}` : url

  async function copy() {
    try {
      await navigator.clipboard.writeText(url)
      toast.success('Link copied.')
    } catch {
      toast.error('Could not copy the link.')
    }
  }

  return (
    <div className="relative overflow-hidden">
      <CameraBackdrop />
      <div className="paper relative mx-auto flex min-h-screen max-w-lg flex-col justify-center gap-4 p-4">
      <div className="flex items-center gap-2">
        {doc?.logo_url ? (
          <img src={doc.logo_url} alt={doc.company_name ?? 'Studio logo'} className="size-9 rounded-lg object-contain" />
        ) : (
          <span className="flex size-9 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            <FileText className="size-5" />
          </span>
        )}
        <div className="min-w-0 flex-1">
          <h1 className="text-lg font-semibold">{doc?.title ?? 'Terms & agreement'}</h1>
          {(doc?.project_name || doc?.client_name || doc?.company_name) && (
            <p className="text-xs text-muted-foreground">
              {[doc.project_name, doc.client_name, doc.company_name].filter(Boolean).join(' · ')}
            </p>
          )}
          {doc?.company_legal_name && doc.company_legal_name !== doc.company_name && (
            <p className="text-xs text-muted-foreground">{doc.company_legal_name}</p>
          )}
          <p className="text-[11px] text-muted-foreground">
            {[doc?.company_phone, doc?.company_email, doc?.company_website, doc?.gstin ? `GSTIN: ${doc.gstin}` : null]
              .filter(Boolean)
              .join(' · ')}
          </p>
          {doc?.company_address && (
            <p className="whitespace-pre-line text-[11px] text-muted-foreground">{doc.company_address}</p>
          )}
        </div>
        <div className="text-right">
          {doc?.document_number && (
            <p className="font-mono text-xs text-muted-foreground">{doc.document_number}</p>
          )}
          {doc?.issued_at && (
            <p className="text-[11px] text-muted-foreground">
              Issued {new Date(doc.issued_at).toLocaleDateString('en-IN')}
            </p>
          )}
          {done && <StatusBadge tone="success">Agreed</StatusBadge>}
        </div>
      </div>

      {loadError ? (
        <Card>
          <CardContent className="p-6 text-center text-sm text-muted-foreground">{loadError}</CardContent>
        </Card>
      ) : done ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-2 p-8 text-center">
            <CheckCircle2 className="size-10 text-success" />
            <p className="font-medium">Thank you, {name}</p>
            <p className="text-sm text-muted-foreground">Your agreement has been recorded.{doc?.already_acknowledged ? ' (Already acknowledged — showing the existing receipt.)' : ''}</p>
            <Button variant="outline" size="sm" onClick={() => window.print()}>
              <Printer className="mr-1 size-4" /> Print receipt
            </Button>
          </CardContent>
        </Card>
      ) : doc === null ? (
        <div className="flex flex-col gap-2 rounded-lg border border-border bg-card p-6" role="status" aria-label="Loading your terms">
          {Array.from({ length: 8 }, (_, i) => (
            <Skeleton key={i} className={i % 3 === 2 ? 'h-3 w-3/4' : 'h-3 w-full'} />
          ))}
        </div>
      ) : (
        <>
          <div className="flex flex-col gap-4">
          {doc.total_cost != null && doc.total_cost > 0 && (
            <Card>
              <CardContent className="p-4 text-sm">
                <div className="flex items-center justify-between">
                  <p className="font-semibold">Project value</p>
                  <p className="font-semibold tabular-nums">₹{doc.total_cost.toLocaleString('en-IN')}</p>
                </div>
              </CardContent>
            </Card>
          )}
          {doc.payment_terms && doc.payment_terms.length > 0 ? (
            <Card>
              <CardContent className="p-4 text-sm">
                <p className="font-semibold">Payment terms</p>
                <div className="mt-2 overflow-x-auto rounded-lg border border-border">
                  <table className="w-full text-xs">
                    <thead className="bg-muted/40 text-left">
                      <tr>
                        <th className="px-2 py-1.5 font-medium">Label</th>
                        <th className="px-2 py-1.5 text-right font-medium">Value</th>
                        <th className="px-2 py-1.5 text-right font-medium">Estimated</th>
                        <th className="px-2 py-1.5 font-medium">Due</th>
                      </tr>
                    </thead>
                    <tbody>
                      {doc.payment_terms.map((p, i) => {
                        const est = p.mode === 'percentage' && doc.total_cost
                          ? ((Number(p.value) || 0) / 100) * doc.total_cost
                          : Number(p.value) || 0
                        return (
                          <tr key={i} className="border-t border-border">
                            <td className="px-2 py-1.5">
                              {p.label}
                              {p.notes ? <div className="text-[10px] text-muted-foreground">{p.notes}</div> : null}
                            </td>
                            <td className="px-2 py-1.5 text-right">{p.mode === 'percentage' ? `${p.value}%` : `₹${Number(p.value ?? 0).toLocaleString('en-IN')}`}</td>
                            <td className="px-2 py-1.5 text-right">₹{Math.round(est).toLocaleString('en-IN')}</td>
                            <td className="px-2 py-1.5">{p.due_trigger ?? '—'}{p.due_date ? ` · ${p.due_date}` : ''}</td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          ) : doc.payment_summary ? (
            <Card>
              <CardContent className="p-4 text-sm">
                <p className="font-semibold">Payment</p>
                <p className="mt-1 text-muted-foreground">{doc.payment_summary}</p>
              </CardContent>
            </Card>
          ) : null}
          {doc.sections.length > 0 && (
            <Card>
              <CardContent className="p-4 text-sm">
                {doc.sections.map((s, i) => (
                  <div key={i} className="mb-3 last:mb-0">
                    {(s['heading'] as string | undefined) && <p className="font-semibold">{String(s['heading'])}</p>}
                    <p className="whitespace-pre-wrap text-muted-foreground">{String(s['body'] ?? '')}</p>
                  </div>
                ))}
              </CardContent>
            </Card>
          )}
          <Card>
            <CardContent className="max-h-[45vh] overflow-auto whitespace-pre-wrap p-6 text-sm leading-relaxed">
              {doc.body}
            </CardContent>
          </Card>
          {doc.legal_note && (
            <p className="border-t border-border pt-3 text-[11px] italic text-muted-foreground">{doc.legal_note}</p>
          )}
          {doc.document_footer_note && (
            <p className="whitespace-pre-line text-[11px] text-muted-foreground">{doc.document_footer_note}</p>
          )}
          <p className="text-[11px] text-muted-foreground">Views on this link: {doc.access_count} (KPIs stub — per-link analytics arrive with the next rollup).</p>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" onClick={() => window.print()}>
              <Printer className="mr-1 size-4" /> Print
            </Button>
            <Button variant="outline" size="sm" asChild>
              <a href={buildWhatsAppUrl(doc.client_phone, shareText)} target="_blank" rel="noreferrer noopener">
                <MessageCircle className="mr-1 size-4" /> WhatsApp
              </a>
            </Button>
            <Button variant="outline" size="sm" asChild>
              <a href={buildMailtoUrl(null, doc.title ?? 'Terms & agreement', shareText)}>
                <Mail className="mr-1 size-4" /> Email
              </a>
            </Button>
            <Button variant="outline" size="sm" onClick={() => void copy()}>
              <Copy className="mr-1 size-4" /> Copy
            </Button>
          </div>
          <Card className="no-print">
            <CardContent className="p-6">
              <form onSubmit={onAgree} className="flex flex-col gap-3">
                <div className="flex flex-col gap-1.5">
                  <Label>Your full name</Label>
                  <Input value={name} onChange={(e) => setName(e.target.value)} required />
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label>Email (optional)</Label>
                  <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
                </div>
                {error && <p className="text-sm text-destructive">{error}</p>}
                <Button type="submit" disabled={busy || !name.trim()}>
                  {busy ? 'Recording…' : 'I agree'}
                </Button>
                <p className="text-center text-xs text-muted-foreground">
                  Your name, time and IP address are recorded as evidence of agreement.
                </p>
              </form>
            </CardContent>
          </Card>
          </div>
        </>
      )}
      </div>
    </div>
  )
}
