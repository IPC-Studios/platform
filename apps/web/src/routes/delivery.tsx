import { useEffect, useState } from 'react'
import { publicDelivery, type PublicDelivery } from '@ipc/contracts'
import { ExternalLink, PackageCheck } from 'lucide-react'
import { callApi } from '@/shared/api/client'
import { CameraBackdrop } from '@/shared/brand/CameraBackdrop'
import { Button } from '@/shared/ui/button'
import { Card, CardContent } from '@/shared/ui/card'
import { Skeleton } from '@/shared/ui/skeleton'

/**
 * PUBLIC page — no auth. Where the finished work is.
 *
 * The studio's own storage does the hosting; this page is the handover note
 * that points at it, so the client has one link that keeps working rather than
 * a Drive URL buried in a chat thread.
 */
export function DeliveryPage() {
  const token = new URLSearchParams(window.location.search).get('token') ?? ''
  const [delivery, setDelivery] = useState<PublicDelivery | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!token) {
      setError('This link is missing its token.')
      return
    }
    callApi(`/public/delivery/${token}`, { responseSchema: publicDelivery })
      .then(setDelivery)
      .catch((e) =>
        setError(
          e instanceof Error ? e.message : 'This link is invalid, expired, or not ready yet.',
        ),
      )
  }, [token])

  return (
    <div className="relative overflow-hidden">
      <CameraBackdrop />
      <div className="relative mx-auto flex min-h-screen max-w-lg flex-col justify-center gap-4 p-4">
        <div className="flex items-center gap-2">
          <span className="flex size-9 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            <PackageCheck className="size-5" />
          </span>
          <div>
            <p className="font-semibold leading-tight">{delivery?.company_name ?? 'Your work'}</p>
            <p className="text-sm text-muted-foreground">
              {delivery?.project_name ?? 'Ready to view'}
            </p>
          </div>
        </div>

        <Card>
          <CardContent className="p-5 sm:p-6">
            {error ? (
              <p className="text-sm text-destructive">{error}</p>
            ) : !delivery ? (
              <div className="flex flex-col gap-2">
                <Skeleton className="h-4 w-2/3" />
                <Skeleton className="h-10 w-full" />
              </div>
            ) : (
              <>
                <p className="font-medium">Your photographs and films are ready.</p>
                {delivery.delivered_at && (
                  <p className="mt-0.5 text-sm text-muted-foreground">
                    Delivered {new Date(delivery.delivered_at).toLocaleDateString('en-IN')}
                  </p>
                )}
                {delivery.notes && (
                  <p className="mt-3 rounded-lg border border-border bg-muted/30 p-3 text-sm">
                    {delivery.notes}
                  </p>
                )}
                {delivery.submission_link ? (
                  <Button asChild className="mt-4 w-full">
                    <a href={delivery.submission_link} target="_blank" rel="noreferrer noopener">
                      <ExternalLink /> Open your gallery
                    </a>
                  </Button>
                ) : (
                  // Approved but with nowhere to point: better to say so than
                  // to show a button that goes nowhere.
                  <p className="mt-4 text-sm text-muted-foreground">
                    The studio has not attached a link yet. Please check back, or ask them.
                  </p>
                )}
              </>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
