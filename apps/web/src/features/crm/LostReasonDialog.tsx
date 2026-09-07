import { useEffect, useState } from 'react'
import { Button } from '@/shared/ui/button'
import { Dialog, DialogContent } from '@/shared/ui/dialog'
import { Label } from '@/shared/ui/input'

/**
 * Why the deal died, in the person's own words. A lost lead without a reason
 * is a lesson nobody can re-read — the API and the database both refuse one,
 * so this is the only way the stage gets set to lost.
 */
export function LostReasonDialog({
  open,
  count,
  pending,
  onCancel,
  onConfirm,
}: {
  open: boolean
  /** How many leads the reason will be attached to. */
  count: number
  pending: boolean
  onCancel: () => void
  onConfirm: (reason: string) => void
}) {
  const [reason, setReason] = useState('')
  const [touched, setTouched] = useState(false)

  useEffect(() => {
    if (open) {
      setReason('')
      setTouched(false)
    }
  }, [open ])

  const trimmed = reason.trim()
  const valid = trimmed.length >= 3
  const showError = touched && !valid

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onCancel()}>
      <DialogContent
        title={`Mark ${count === 1 ? 'lead' : `${count} leads`} as lost`}
        description="Say why, briefly. It lands on the lead's history and in the lost analysis."
      >
        <form
          className="flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault()
            if (!valid || pending) {
              setTouched(true)
              return
            }
            onConfirm(trimmed)
          }}
        >
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="lost-reason">Reason</Label>
            <textarea
              id="lost-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              onBlur={() => setTouched(true)}
              rows={3}
              autoFocus
              maxLength={500}
              placeholder="Budget, timing, went elsewhere…"
              aria-invalid={showError || undefined}
              aria-describedby={showError ? 'lost-reason-error' : undefined}
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring aria-invalid:border-destructive"
            />
            {showError ? (
              <p id="lost-reason-error" role="alert" className="text-xs font-medium text-destructive">
                Give at least 3 characters.
              </p>
            ) : (
              <p className="text-xs text-muted-foreground">At least 3 characters.</p>
            )}
          </div>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={onCancel} disabled={pending}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending || !valid}>
              {pending ? 'Saving…' : 'Mark lost'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
