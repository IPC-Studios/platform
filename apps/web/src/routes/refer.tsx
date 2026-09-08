import { useEffect, useState, type FormEvent } from 'react'
import { useParams } from '@tanstack/react-router'
import { Gift, CheckCircle2 } from 'lucide-react'
import { publicReferralCampaign, z, type PublicReferralCampaign } from '@ipc/contracts'

const created = z.object({ id: z.string().uuid() })
import { callApi, ApiError } from '@/shared/api/client'
import { CameraBackdrop } from '@/shared/brand/CameraBackdrop'
import { Button } from '@/shared/ui/button'
import { Card, CardContent } from '@/shared/ui/card'
import { Input, Label } from '@/shared/ui/input'
import { Skeleton } from '@/shared/ui/skeleton'
import { formatINR } from '@/shared/ui/format'

const REWARD_LABEL: Record<PublicReferralCampaign['reward_type'], (v: number) => string> = {
  percentage: (v) => `${v}% off their next booking`,
  fixed: (v) => `${formatINR(v)} credit`,
  credit: (v) => `${formatINR(v)} studio credit`,
  custom: () => 'a thank-you reward',
}

/**
 * PUBLIC page — no auth, no app shell. What a past client's friend sees when
 * they follow a shared referral link: who's asking, what's in it for them,
 * and a short form to introduce themselves.
 */
export function ReferPage() {
  const { slug } = useParams({ from: '/refer/$slug' })
  const [campaign, setCampaign] = useState<PublicReferralCampaign | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [referrerName, setReferrerName] = useState('')
  const [referrerPhone, setReferrerPhone] = useState('')
  const [clientName, setClientName] = useState('')
  const [clientPhone, setClientPhone] = useState('')
  const [clientEmail, setClientEmail] = useState('')
  const [notes, setNotes] = useState('')
  const [done, setDone] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    callApi(`/public/referrals/campaign/${slug}`, { responseSchema: publicReferralCampaign })
      .then(setCampaign)
      .catch((e) => setLoadError(e instanceof ApiError ? e.message : 'This referral link is invalid or no longer active.'))
  }, [slug])

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    if (!campaign) return
    setError(null)
    setBusy(true)
    try {
      await callApi(`/public/referrals/submit?campaign_id=${campaign.campaign_id}`, {
        method: 'POST',
        body: {
          referrer_name: referrerName.trim() || undefined,
          referrer_phone: referrerPhone.trim() || undefined,
          client_name: clientName.trim(),
          client_phone: clientPhone.trim() || undefined,
          client_email: clientEmail.trim() || undefined,
          notes: notes.trim() || undefined,
        },
        responseSchema: created,
      })
      setDone(true)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'We could not submit this referral.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="relative flex min-h-screen items-center justify-center bg-background p-4 font-sans">
      <CameraBackdrop />
      <Card className="relative z-10 w-full max-w-lg">
        <CardContent className="flex flex-col gap-5 p-6">
          <div className="flex items-center gap-3">
            <span className="flex size-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <Gift className="size-5" />
            </span>
            <div className="min-w-0">
              <p className="text-xs uppercase tracking-wider text-muted-foreground">
                {campaign?.studio_name ?? "You've been referred"}
              </p>
              <h1 className="truncate text-lg font-semibold">{campaign?.name ?? 'Refer a friend'}</h1>
            </div>
          </div>

          {loadError ? (
            <p className="text-sm text-destructive">{loadError}</p>
          ) : !campaign ? (
            <Skeleton className="h-40" />
          ) : done ? (
            <div className="flex flex-col items-center gap-2 py-6 text-center">
              <CheckCircle2 className="size-10 text-success" />
              <p className="font-medium">Thanks — we've got it.</p>
              <p className="text-sm text-muted-foreground">{campaign.studio_name ?? 'The studio'} will reach out shortly.</p>
            </div>
          ) : (
            <form onSubmit={onSubmit} className="flex flex-col gap-4">
              {campaign.description && <p className="text-sm text-muted-foreground">{campaign.description}</p>}
              <p className="rounded-lg bg-muted/30 p-3 text-sm">
                {campaign.reward_description ?? `Refer a friend and get ${REWARD_LABEL[campaign.reward_type](campaign.reward_value)}, once they book.`}
              </p>

              <div className="grid gap-3 sm:grid-cols-2">
                <div className="flex flex-col gap-1.5">
                  <Label>Your name</Label>
                  <Input value={referrerName} onChange={(e) => setReferrerName(e.target.value)} placeholder="Optional" />
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label>Your phone</Label>
                  <Input value={referrerPhone} onChange={(e) => setReferrerPhone(e.target.value)} placeholder="Optional" />
                </div>
              </div>

              <div className="flex flex-col gap-1.5">
                <Label>
                  Your friend's name <span className="text-destructive">*</span>
                </Label>
                <Input value={clientName} onChange={(e) => setClientName(e.target.value)} required />
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <div className="flex flex-col gap-1.5">
                  <Label>Their phone</Label>
                  <Input value={clientPhone} onChange={(e) => setClientPhone(e.target.value)} placeholder="98765 43210" />
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label>Their email</Label>
                  <Input type="email" value={clientEmail} onChange={(e) => setClientEmail(e.target.value)} placeholder="Optional" />
                </div>
              </div>

              <div className="flex flex-col gap-1.5">
                <Label>Anything else?</Label>
                <textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  rows={2}
                  placeholder="What are they celebrating, roughly when…"
                  className="w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm"
                />
              </div>

              {error && (
                <p role="alert" className="text-sm text-destructive">
                  {error}
                </p>
              )}
              <Button type="submit" disabled={busy || !clientPhone.trim() && !clientEmail.trim()}>
                {busy ? 'Sending…' : 'Send referral'}
              </Button>
              {!clientPhone.trim() && !clientEmail.trim() && (
                <p className="text-xs text-muted-foreground">Add a phone or email so the studio can reach them.</p>
              )}
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
