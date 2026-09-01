import { useEffect, useState } from 'react'
import { Check, Copy, Flame, Mail, Phone } from 'lucide-react'
import { toast } from 'sonner'
import type { CrmLead, LeadStatus } from '@ipc/contracts'
import { Button } from '@/shared/ui/button'
import { Dialog, DialogContent } from '@/shared/ui/dialog'
import { Input, Label, Select } from '@/shared/ui/input'
import { StatusBadge } from '@/shared/ui/status-badge'
import { cn } from '@/shared/ui/cn'
import { useLeads, useUpdateLead } from './api'
import { STAGES, dueBucket } from './leads'

/** A datetime-local value from an ISO string, in the viewer's own timezone. */
function toLocalInput(iso: string | null): string {
  if (!iso) return ''
  const at = new Date(iso)
  if (Number.isNaN(at.getTime())) return ''
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}T${pad(at.getHours())}:${pad(at.getMinutes())}`
}

const QUICK_DATES: ReadonlyArray<{ label: string; days: number }> = [
  { label: 'Tomorrow', days: 1 },
  { label: 'In 3 days', days: 3 },
  { label: 'Next week', days: 7 },
]

/**
 * The whole lead on one surface: who they are, where the conversation is, and
 * when it continues. Everything saves on the spot — this is opened between
 * phone calls, not filled in like a form.
 */
export function LeadDrawer({ lead, onClose }: { lead: CrmLead; onClose: () => void }) {
  const update = useUpdateLead()
  const { data: leads } = useLeads()
  const [notes, setNotes] = useState(lead.notes ?? '')
  const [followUp, setFollowUp] = useState(toLocalInput(lead.follow_up_at))
  const [copied, setCopied] = useState(false)

  // A refetch can land while this is open; take the server's version unless the
  // person is mid-edit on that field.
  useEffect(() => {
    setNotes(lead.notes ?? '')
    setFollowUp(toLocalInput(lead.follow_up_at))
  }, [lead.id, lead.notes, lead.follow_up_at])

  const owners = [...new Map((leads ?? []).flatMap((l) => (l.assigned_to ? [[l.assigned_to, l.assignee_name ?? 'Unknown']] as const : []))).entries()]
  const patch = (p: Parameters<typeof update.mutate>[0]['patch']) =>
    update.mutate({ id: lead.id, patch: p })

  const bucket = dueBucket(lead, new Date())

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent
        title={lead.name ?? 'Unnamed lead'}
        description={`${lead.source} · added ${new Date(lead.created_at).toLocaleDateString('en-IN')}`}
        className="max-w-xl"
      >
        <div className="flex flex-col gap-5">
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge tone={lead.is_hot ? 'danger' : 'neutral'}>
              {lead.is_hot ? 'Hot lead' : 'Normal'}
            </StatusBadge>
            {bucket === 'overdue' && <StatusBadge tone="danger">Follow-up overdue</StatusBadge>}
            {bucket === 'today' && <StatusBadge tone="warning">Due today</StatusBadge>}
            {lead.last_contacted_at === null && <StatusBadge tone="warning">Never contacted</StatusBadge>}
          </div>

          {/* Reaching the person is the point of the screen, so it comes first. */}
          <div className="flex flex-wrap gap-2">
            {lead.phone && (
              <>
                <Button variant="outline" size="sm" asChild>
                  <a href={`tel:${lead.phone}`}>
                    <Phone /> {lead.phone}
                  </a>
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    void navigator.clipboard.writeText(lead.phone!)
                    setCopied(true)
                    toast.success('Number copied')
                  }}
                >
                  {copied ? <Check /> : <Copy />} Copy
                </Button>
              </>
            )}
            {lead.email && (
              <Button variant="outline" size="sm" asChild>
                <a href={`mailto:${lead.email}`}>
                  <Mail /> {lead.email}
                </a>
              </Button>
            )}
            <Button
              variant={lead.is_hot ? 'default' : 'outline'}
              size="sm"
              onClick={() => patch({ is_hot: !lead.is_hot })}
            >
              <Flame /> {lead.is_hot ? 'Hot' : 'Mark hot'}
            </Button>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <Label>Stage</Label>
              <Select
                value={lead.status}
                onChange={(e) => patch({ status: e.target.value as LeadStatus })}
                disabled={update.isPending}
              >
                {STAGES.map((s) => (
                  <option key={s.key} value={s.key}>
                    {s.label}
                  </option>
                ))}
              </Select>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>Owner</Label>
              <Select
                value={lead.assigned_to ?? ''}
                onChange={(e) => patch({ assigned_to: e.target.value || null })}
                disabled={update.isPending}
              >
                <option value="">Unassigned</option>
                {owners.map(([id, name]) => (
                  <option key={id} value={id}>
                    {name}
                  </option>
                ))}
              </Select>
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label>Next follow-up</Label>
            <div className="flex flex-wrap items-center gap-2">
              <Input
                type="datetime-local"
                value={followUp}
                onChange={(e) => setFollowUp(e.target.value)}
                className="w-56"
              />
              <Button
                size="sm"
                disabled={update.isPending || followUp === toLocalInput(lead.follow_up_at)}
                onClick={() =>
                  patch({ follow_up_at: followUp ? new Date(followUp).toISOString() : null })
                }
              >
                Set
              </Button>
              {lead.follow_up_at && (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => patch({ follow_up_at: null })}
                  disabled={update.isPending}
                >
                  Clear
                </Button>
              )}
            </div>
            <div className="mt-1 flex flex-wrap gap-1.5">
              {QUICK_DATES.map((q) => (
                <button
                  key={q.label}
                  type="button"
                  onClick={() => {
                    const at = new Date()
                    at.setDate(at.getDate() + q.days)
                    at.setHours(10, 0, 0, 0)
                    patch({ follow_up_at: at.toISOString() })
                  }}
                  className={cn(
                    'rounded-full border border-border px-2.5 py-1 text-xs text-muted-foreground',
                    'transition-colors hover:border-primary/40 hover:text-foreground',
                  )}
                >
                  {q.label}
                </button>
              ))}
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label>Notes</Label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={4}
              placeholder="What was said, what they asked for, what you promised."
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
            <div className="flex justify-end">
              <Button
                size="sm"
                variant="outline"
                disabled={update.isPending || notes === (lead.notes ?? '')}
                onClick={() => patch({ notes })}
              >
                Save notes
              </Button>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
