import { useEffect, useState } from 'react'
import { Link } from '@tanstack/react-router'
import { Archive, Megaphone, Timer } from 'lucide-react'
import type { CrmLead } from '@ipc/contracts'
import { Button } from '@/shared/ui/button'
import { Card, CardContent } from '@/shared/ui/card'
import { Input, Label } from '@/shared/ui/input'
import { Skeleton } from '@/shared/ui/skeleton'
import { useConfirm } from '@/shared/ui/confirm'
import { useAccess } from '@/shared/auth/useAccess'
import { useAuth } from '@/shared/auth/AuthProvider'
import { useBulkPatch, useCrmSettings, useUpdateCrmSettings } from '../api'

/** Housekeeping: the things done once a quarter, not once an hour. */
export function CrmSettingsTab({ leads, archived }: { leads: readonly CrmLead[]; archived: readonly CrmLead[] }) {
  const bulk = useBulkPatch()
  const confirm = useConfirm()
  const access = useAccess()
  const canEdit = access.hasAction('crm', 'edit')
  const lost = leads.filter((l) => l.status === 'lost')

  async function archiveLost() {
    if (lost.length === 0) return
    const yes = await confirm({
      title: `Archive ${lost.length} lost lead${lost.length === 1 ? '' : 's'}?`,
      description: 'They leave the inbox and boards but stay in reports and history. Undo is offered right after.',
      confirmLabel: 'Archive',
    })
    if (yes) bulk.mutate({ ids: lost.map((l) => l.id), patch: { is_archived: true } })
  }

  return (
    <div className="grid gap-4 md:grid-cols-2">
      <SlaCard />
      <Card>
        <CardContent className="flex flex-col gap-3 p-5">
          <p className="flex items-center gap-2 font-medium">
            <Archive className="size-4 text-muted-foreground" /> Archive lost leads
          </p>
          <p className="text-sm text-muted-foreground">
            {lost.length} lost lead{lost.length === 1 ? '' : 's'} in the inbox, {archived.length} already archived. Archiving keeps them for reports and hides them from the working lists.
          </p>
          <div>
            <Button variant="outline" disabled={!canEdit || lost.length === 0 || bulk.isPending} onClick={() => void archiveLost()}>
              Archive {lost.length} lost lead{lost.length === 1 ? '' : 's'}
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">Tick “Show archived” in the inbox to see or restore them.</p>
        </CardContent>
      </Card>
      <Card>
        <CardContent className="flex flex-col gap-3 p-5">
          <p className="flex items-center gap-2 font-medium">
            <Megaphone className="size-4 text-muted-foreground" /> Where leads come from
          </p>
          <p className="text-sm text-muted-foreground">
            Web forms and Meta lead ads post straight into this inbox. Each source has its own URL you can pause or delete.
          </p>
          <div>
            <Button variant="outline" asChild>
              <Link to="/lead-sources">Manage lead sources</Link>
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

/** The response-time target the Team Dashboard measures everyone against. */
function SlaCard() {
  const { session } = useAuth()
  const { data, isLoading } = useCrmSettings()
  const save = useUpdateCrmSettings()
  const [hours, setHours] = useState('')
  const [error, setError] = useState<string | null>(null)
  const isOwner = !!session?.is_owner

  useEffect(() => {
    if (data) setHours(String(data.sla_hours))
  }, [data])

  function onSave() {
    setError(null)
    const n = Number(hours)
    if (!Number.isInteger(n) || n < 1 || n > 720) {
      setError('Between 1 and 720 hours.')
      return
    }
    save.mutate({ sla_hours: n })
  }

  return (
    <Card>
      <CardContent className="flex flex-col gap-3 p-5">
        <p className="flex items-center gap-2 font-medium">
          <Timer className="size-4 text-muted-foreground" /> First-contact SLA
        </p>
        <p className="text-sm text-muted-foreground">
          How long a new lead may wait before someone reaches out and it still counts as on time. The Team Dashboard shows each person's share within it.
        </p>
        {isLoading ? (
          <Skeleton className="h-9 w-40" />
        ) : (
          <div className="flex flex-wrap items-end gap-2">
            <div className="flex flex-col gap-1">
              <Label htmlFor="sla-hours">Hours</Label>
              <Input
                id="sla-hours"
                type="number"
                min={1}
                max={720}
                value={hours}
                onChange={(e) => setHours(e.target.value)}
                disabled={!isOwner}
                className="w-28"
                aria-invalid={!!error}
                aria-describedby={error ? 'sla-error' : undefined}
              />
            </div>
            <Button size="sm" disabled={!isOwner || save.isPending || hours === String(data?.sla_hours ?? '')} onClick={onSave}>
              Save
            </Button>
          </div>
        )}
        {error && (
          <p id="sla-error" className="text-sm text-destructive">
            {error}
          </p>
        )}
        {!isOwner && <p className="text-xs text-muted-foreground">Only the studio owner can change this.</p>}
      </CardContent>
    </Card>
  )
}
