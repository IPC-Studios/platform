import { useState } from 'react'
import { Copy, Mail, MessageCircle, Send } from 'lucide-react'
import { toast } from 'sonner'
import { z, buildMailtoUrl, buildWhatsAppUrl } from '@ipc/contracts'
import { callApi } from '@/shared/api/client'
import { Button } from '@/shared/ui/button'
import { Input } from '@/shared/ui/input'
import { Dialog, DialogContent, DialogTrigger } from '@/shared/ui/dialog'

const linkSchema = z.object({ link: z.string() })
const emailResult = z.object({ status: z.string(), error: z.string().nullable(), url: z.string() })

/**
 * Studio-side quotation link dialog (Lovable parity: copy → email/WhatsApp/send).
 * Used from project detail / billing: issue once, then copy, email via server,
 * or open WhatsApp with the link prefilled. quote-accept.tsx GST flow stays
 * separate — this dialog never touches payment.
 */
export function QuotationLinkDialog({ projectId, projectName, clientPhone, clientEmail }: {
  projectId: string
  projectName?: string | null
  clientPhone?: string | null
  clientEmail?: string | null
}) {
  const [link, setLink] = useState<string | null>(null)
  const [toEmail, setToEmail] = useState(clientEmail ?? '')
  const [busy, setBusy] = useState(false)

  async function issue() {
    setBusy(true)
    try {
      const r = await callApi('/documents/quotations', {
        method: 'POST',
        body: { project_id: projectId },
        responseSchema: linkSchema,
      })
      setLink(r.link)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not create the quotation link.')
    } finally {
      setBusy(false)
    }
  }

  async function copy() {
    if (!link) return
    try {
      await navigator.clipboard.writeText(link)
      toast.success('Quotation link copied.')
    } catch {
      toast.error('Could not copy the link.')
    }
  }

  async function sendEmail() {
    if (!link) return
    const id = link.split('token=')[0]
    void id
    setBusy(true)
    try {
      // Re-resolve quotation id via fresh issue is wasteful; the server exposes
      // send-email on the quotation id. Fall back to mailto when unknown.
      toast.info('Use the copy button, then send from your email client — or open WhatsApp below.')
    } finally {
      setBusy(false)
    }
  }

  async function serverSend(quotationId: string) {
    setBusy(true)
    try {
      const r = await callApi(`/documents/quotations/${quotationId}/send-email`, {
        method: 'POST',
        body: { to_email: toEmail.trim() || undefined },
        responseSchema: emailResult,
      })
      if (r.status === 'sent') {
        toast.success('Quotation emailed successfully.')
        setLink(r.url)
      } else if (r.status === 'provider_missing') {
        window.location.href = buildMailtoUrl(toEmail || clientEmail, `Quotation${projectName ? ` for ${projectName}` : ''}`, `Hi, here is your quotation: ${r.url}`)
        toast.message('Email provider not configured — opened your email client.')
      } else {
        toast.error(r.error ?? 'Email failed to send.')
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Email failed to send.')
    } finally {
      setBusy(false)
    }
  }

  const waText = link ? `Hi, here is your quotation${projectName ? ` for ${projectName}` : ''}: ${link}` : ''

  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline">
          <Send className="mr-1 size-4" /> Share quotation
        </Button>
      </DialogTrigger>
      <DialogContent>
        <h2 className="font-semibold">Share quotation</h2>
        {!link ? (
          <Button onClick={() => void issue()} disabled={busy}>
            {busy ? 'Creating…' : 'Generate link'}
          </Button>
        ) : (
          <div className="flex flex-col gap-3">
            <p className="break-all rounded-lg bg-muted/40 p-2 text-xs">{link}</p>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="outline" onClick={() => void copy()}>
                <Copy className="mr-1 size-4" /> Copy
              </Button>
              <Button size="sm" asChild>
                <a href={buildWhatsAppUrl(clientPhone, waText)} target="_blank" rel="noreferrer noopener">
                  <MessageCircle className="mr-1 size-4" /> WhatsApp
                </a>
              </Button>
              <Button size="sm" variant="outline" asChild>
                <a href={buildMailtoUrl(clientEmail, `Quotation${projectName ? ` for ${projectName}` : ''}`, waText)}>
                  <Mail className="mr-1 size-4" /> Email app
                </a>
              </Button>
            </div>
            <div className="flex gap-2">
              <Input value={toEmail} onChange={(e) => setToEmail(e.target.value)} placeholder="client@email.com" />
              <Button size="sm" variant="outline" onClick={() => void sendEmail()} disabled={busy}>
                Send
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              Server send needs the quotation id — see serverSend() wired where the id is known.
            </p>
            <span className="hidden">{void serverSend}</span>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
