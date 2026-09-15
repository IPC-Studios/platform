import { useEffect, useState } from 'react'
import { Button } from '@/shared/ui/button'
import { Dialog, DialogContent, DialogFooter } from '@/shared/ui/dialog'
import { Input, Label } from '@/shared/ui/input'

/**
 * Delete confirmation with an acknowledgement checkbox and an optional
 * reason (recorded in the audit trail). Ported from Lovable's
 * DeleteEmployeeDialog; past shoots, tasks, attendance and payouts stay
 * on the record — only future access goes.
 */
export function DeleteEmployeeDialog({
  open,
  onOpenChange,
  count,
  pending,
  onConfirm,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  count: number
  pending?: boolean
  onConfirm: (reason: string | null) => void | Promise<void>
}) {
  const [ack, setAck] = useState(false)
  const [reason, setReason] = useState('')
  const bulk = count > 1

  useEffect(() => {
    if (!open) {
      setAck(false)
      setReason('')
    }
  }, [open ])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title={bulk ? 'Delete selected team members?' : 'Delete team member?'}
        description={`This will remove ${bulk ? 'these members' : 'the member'} from active team lists and future assignments. Past projects, tasks, attendance, and data records will remain saved.`}
      >
        <div className="flex flex-col gap-3 py-2">
          <label className="flex items-start gap-2 text-sm">
            <input
              id="delete-ack"
              type="checkbox"
              checked={ack}
              onChange={(e) => setAck(e.target.checked)}
              className="mt-0.5"
            />
            <span>I understand this keeps historical records but removes future access.</span>
          </label>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="delete-reason" className="text-xs text-muted-foreground">
              Reason (optional)
            </Label>
            <Input
              id="delete-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value.slice(0, 500))}
              placeholder="e.g. Left the studio"
            />
          </div>
        </div>
        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            disabled={!ack || pending}
            onClick={() => void onConfirm(reason.trim() ? reason.trim() : null)}
          >
            {pending ? 'Deleting…' : bulk ? 'Delete selected' : 'Delete member'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
