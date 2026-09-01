import { useEffect, useState, type FormEvent } from 'react'
import { z } from '@ipc/contracts'
import { CheckCircle2, FileText } from 'lucide-react'
import { callApi, ApiError } from '@/shared/api/client'
import { CameraBackdrop } from '@/shared/brand/CameraBackdrop'
import { Button } from '@/shared/ui/button'
import { Card, CardContent } from '@/shared/ui/card'
import { Input, Label } from '@/shared/ui/input'
import { LoadingState } from '@/shared/ui/states'

const termsBody = z.object({ body: z.string() })

/**
 * PUBLIC page — no auth. A client opens the emailed link (?token=…), reads the
 * terms, and taps "I agree". No app shell; this is the only thing they see.
 */
export function TermsAcknowledgePage() {
  const token = new URLSearchParams(window.location.search).get('token') ?? ''
  const [body, setBody] = useState<string | null>(null)
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
    callApi(`/public/terms/${token}`, { responseSchema: termsBody })
      .then((r) => setBody(r.body))
      .catch((e) => setLoadError(e instanceof Error ? e.message : 'This link is invalid or expired.'))
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

  return (
    <div className="relative overflow-hidden">
      <CameraBackdrop />
      <div className="relative mx-auto flex min-h-screen max-w-lg flex-col justify-center gap-4 p-4">
      <div className="flex items-center gap-2">
        <span className="flex size-9 items-center justify-center rounded-lg bg-primary text-primary-foreground">
          <FileText className="size-5" />
        </span>
        <h1 className="text-lg font-semibold">Terms & agreement</h1>
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
            <p className="text-sm text-muted-foreground">Your agreement has been recorded.</p>
          </CardContent>
        </Card>
      ) : body === null ? (
        <LoadingState label="Loading your terms…" />
      ) : (
        <>
          <Card>
            <CardContent className="max-h-[45vh] overflow-auto whitespace-pre-wrap p-6 text-sm leading-relaxed">
              {body}
            </CardContent>
          </Card>
          <Card>
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
        </>
      )}
      </div>
    </div>
  )
}
