import { useState } from 'react'
import { toast } from 'sonner'
import { Check, Copy, Mail, MessageCircle } from 'lucide-react'
import { Button } from '@/shared/ui/button'
import { Dialog, DialogContent, DialogFooter } from '@/shared/ui/dialog'
import { Input, Label } from '@/shared/ui/input'

/**
 * Send finished work to the client (Lovable parity with
 * SendWorkToClientDialog): copy the link, open WhatsApp with a prefilled
 * message, or open the client's mail app. No sending happens server-side —
 * these hand off to the apps the studio already uses.
 */
export function SendWorkToClientDialog({
  open,
  onClose,
  link,
  projectName,
  clientName,
  clientEmail,
  clientPhone,
}: {
  open: boolean
  onClose: () => void
  link: string
  projectName: string | null
  clientName: string | null
  clientEmail: string | null
  clientPhone: string | null
}) {
  const [copied, setCopied] = useState(false)
  const [email, setEmail] = useState(clientEmail ?? '')
  const [phone, setPhone] = useState(clientPhone ?? '')

  const message = `Hi ${clientName ?? 'there'}, your ${projectName ? `${projectName} ` : ''}work is ready: ${link}`

  async function copy() {
    try {
      await navigator.clipboard.writeText(link)
      setCopied(true)
      toast.success('Link copied.')
      setTimeout(() => setCopied(false), 2000)
    } catch {
      toast.error('Could not copy. Select the link manually.')
    }
  }

  function whatsapp() {
    const digits = phone.replace(/\D/g, '')
    const url = digits
      ? `https://wa.me/${digits}?text=${encodeURIComponent(message)}`
      : `https://wa.me/?text=${encodeURIComponent(message)}`
    window.open(url, '_blank', 'noopener')
  }

  function sendEmail() {
    if (!email.trim()) {
      toast.error('Add the client email first.')
      return
    }
    const subject = encodeURIComponent(`${projectName ?? 'Your work'} is ready`)
    window.location.href = `mailto:${email.trim()}?subject=${subject}&body=${encodeURIComponent(message)}`
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose() }}>
      <DialogContent title="Send to client" description="Share the finished work link on the channel the client answers.">
        <div className="flex flex-col gap-3">
          <div className="flex items-center gap-2 rounded-md border border-border bg-muted/30 p-3 text-sm">
            <span className="min-w-0 flex-1 truncate">{link}</span>
            <Button size="sm" variant="outline" onClick={() => void copy()}>
              {copied ? <Check /> : <Copy />} {copied ? 'Copied' : 'Copy'}
            </Button>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <Label>Client phone (WhatsApp)</Label>
              <Input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="e.g. 98765 43210" />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>Client email</Label>
              <Input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="client@example.com" type="email" />
            </div>
          </div>
        </div>
        <DialogFooter className="flex-wrap gap-2">
          <Button variant="outline" onClick={whatsapp}>
            <MessageCircle /> WhatsApp
          </Button>
          <Button variant="outline" onClick={sendEmail}>
            <Mail /> Email
          </Button>
          <Button onClick={() => void copy()}>
            <Copy /> Copy link
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
