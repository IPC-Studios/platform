import { useState } from 'react'
import { Merge, Undo2 } from 'lucide-react'
import type { CrmLead } from '@ipc/contracts'
import { Button } from '@/shared/ui/button'
import { SkeletonCards } from '@/shared/ui/skeleton'
import { Card, CardContent } from '@/shared/ui/card'
import { StatusBadge } from '@/shared/ui/status-badge'
import { EmptyState, ErrorState } from '@/shared/ui/states'
import { useConfirm } from '@/shared/ui/confirm'
import { useAccess } from '@/shared/auth/useAccess'
import { useDuplicateGroups, useMerge, useUnmerge } from '../api'
import { STAGE_LABEL } from '../leads'
import { STAGE_TONE, prettyDate } from './shared'

/**
 * Leads that share a phone number. Merge folds the others into a survivor;
 * the survivor keeps a note of what was folded in and can unmerge it.
 * `archivedLeads` are the ones merged so far, so the undo is right here —
 * and `allLeads` includes the survivors, which merge deliberately leaves
 * unarchived and which the undo list therefore could not name.
 */
export function DuplicatesTab({ archivedLeads, allLeads }: { archivedLeads: readonly CrmLead[]; allLeads: readonly CrmLead[] }) {
  const { data, isLoading, isError, error, refetch } = useDuplicateGroups()
  const merge = useMerge()
  const unmerge = useUnmerge()
  const confirm = useConfirm()
  const access = useAccess()
  const canEdit = access.hasAction('crm', 'edit')
  const [pick, setPick] = useState<Record<string, string>>({})

  // Survivors with something merged into them, for the undo list.
  const merged = new Map<string, number>()
  for (const l of archivedLeads) if (l.merged_into) merged.set(l.merged_into, (merged.get(l.merged_into) ?? 0) + 1)

  if (isLoading) return <SkeletonCards count={3} />
  if (isError) return <ErrorState error={error} onRetry={() => void refetch()} />

  async function doMerge(phone: string, ids: string[]) {
    const survivor = pick[phone]
    if (!survivor) return
    const dups = ids.filter((x) => x !== survivor)
    const yes = await confirm({
      title: `Merge ${dups.length} duplicate${dups.length === 1 ? '' : 's'}?`,
      description: 'Their notes move onto the lead you picked and they are archived. You can unmerge from this tab.',
      confirmLabel: 'Merge',
    })
    if (yes) merge.mutate({ survivor_id: survivor, duplicate_ids: dups })
  }

  const groups = data ?? []

  return (
    <div className="flex flex-col gap-4">
      {groups.length === 0 ? (
        <Card>
          <CardContent className="py-4">
            <EmptyState title="No duplicates" description="No two open leads share a phone number." />
          </CardContent>
        </Card>
      ) : (
        groups.map((g) => (
          <Card key={g.phone_norm}>
            <CardContent className="p-4">
              <p className="flex flex-wrap items-center gap-2 text-sm font-medium">
                Phone +{g.phone_norm}
                <StatusBadge tone="warning">{g.lead_count} leads</StatusBadge>
              </p>
              <p className="mt-0.5 text-xs text-muted-foreground">Pick the one to keep. The others fold into it.</p>
              <ul className="mt-3 flex flex-col gap-1.5">
                {g.leads.map((l) => (
                  <li key={l.id}>
                    <label className="flex cursor-pointer flex-wrap items-center gap-2 rounded-md border border-border p-2 text-sm has-[:checked]:border-primary has-[:checked]:bg-primary/5">
                      <input
                        type="radio"
                        name={`survivor-${g.phone_norm}`}
                        checked={pick[g.phone_norm] === l.id}
                        onChange={() => setPick((p) => ({ ...p, [g.phone_norm]: l.id }))}
                        disabled={!canEdit}
                      />
                      <span className="font-medium">{l.name ?? 'Unnamed lead'}</span>
                      <StatusBadge tone={STAGE_TONE[l.status]}>{STAGE_LABEL[l.status]}</StatusBadge>
                      <span className="text-xs text-muted-foreground">{l.source} · added {prettyDate(l.created_at)}</span>
                      {l.notes && <span className="w-full truncate text-xs text-muted-foreground">{l.notes}</span>}
                    </label>
                  </li>
                ))}
              </ul>
              {canEdit && (
                <Button size="sm" className="mt-3" disabled={!pick[g.phone_norm] || merge.isPending} onClick={() => void doMerge(g.phone_norm, g.lead_ids)}>
                  <Merge /> Merge into the selected lead
                </Button>
              )}
            </CardContent>
          </Card>
        ))
      )}

      {merged.size > 0 && (
        <Card>
          <CardContent className="p-4">
            <p className="font-medium">Merged recently</p>
            <p className="mt-0.5 text-xs text-muted-foreground">Unmerging brings the folded leads back exactly as they were.</p>
            <ul className="mt-3 divide-y divide-border">
              {[...merged.entries()].map(([survivorId, n]) => {
                const survivor = allLeads.find((l) => l.id === survivorId)
                return (
                  <li key={survivorId} className="flex flex-wrap items-center gap-3 py-2 text-sm">
                    <span className="min-w-0 flex-1 truncate font-medium">{survivor?.name ?? survivor?.phone ?? 'Lead'}</span>
                    <StatusBadge tone="neutral">{n} merged in</StatusBadge>
                    {canEdit && (
                      <Button size="sm" variant="outline" disabled={unmerge.isPending} onClick={() => unmerge.mutate(survivorId)}>
                        <Undo2 /> Unmerge
                      </Button>
                    )}
                  </li>
                )
              })}
            </ul>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
