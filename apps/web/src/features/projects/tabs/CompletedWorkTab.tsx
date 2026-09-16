import { useState } from 'react'
import { FileCheck, ExternalLink, HardDrive, Folder } from 'lucide-react'
import type { WorkSubmission } from '@ipc/contracts'
import { Button } from '@/shared/ui/button'
import { Card, CardContent } from '@/shared/ui/card'
import { StatusBadge } from '@/shared/ui/status-badge'
import { FilterTabs } from '@/shared/layout/filter-tabs'
import { SkeletonList } from '@/shared/ui/skeleton'
import { ErrorState, EmptyState } from '@/shared/ui/states'
import { humanize } from '@/shared/ui/format'
import { useProjectWorkSubmissions, useReviewWork } from '@/features/work/api'

const TONE: Record<WorkSubmission['status'], 'neutral' | 'success' | 'danger'> = {
  submitted: 'neutral',
  approved: 'success',
  rejected: 'danger',
}

/** Work the team has submitted for this project, and its review status. */
export function CompletedWorkTab({ projectId, canReview }: { projectId: string; canReview: boolean }) {
  const { data, isLoading, isError, refetch } = useProjectWorkSubmissions(projectId)
  const review = useReviewWork()
  const [filter, setFilter] = useState<'all' | 'submitted' | 'approved' | 'rejected'>('all')

  const all = data ?? []
  const rows = filter === 'all' ? all : all.filter((s) => s.status === filter)
  const count = (st: 'submitted' | 'approved' | 'rejected') => all.filter((s) => s.status === st).length

  return (
    <div className="mt-4 flex flex-col gap-3">
      <div>
        <h2 className="text-sm font-semibold text-muted-foreground">Completed work on this project</h2>
        <p className="mt-0.5 text-xs text-muted-foreground">
          What the team has handed in — the link or the drive it lives on. Approve it, or send it back for a
          revision.
        </p>
      </div>

      {all.length > 0 && (
        <FilterTabs
          tabs={[
            { value: 'all', label: 'All', count: all.length },
            { value: 'submitted', label: 'Awaiting review', count: count('submitted') },
            { value: 'approved', label: 'Approved', count: count('approved') },
            { value: 'rejected', label: 'Sent back', count: count('rejected') },
          ]}
          value={filter}
          onChange={setFilter}
        />
      )}

      {isLoading ? (
        <SkeletonList rows={3} columns={3} />
      ) : isError ? (
        <ErrorState onRetry={() => void refetch()} />
      ) : all.length === 0 ? (
        <EmptyState
          title="Nothing submitted yet"
          description="Work your team submits from a task or shoot will show up here for review."
        />
      ) : rows.length === 0 ? (
        <EmptyState title="Nothing in this state" description="Try a different filter." />
      ) : (
        <ul className="flex flex-col gap-2">
          {rows.map((s) => (
            <li key={s.id}>
              <Card>
                <CardContent className="flex flex-wrap items-center gap-3 p-4">
                  <FileCheck className="size-4 shrink-0 text-muted-foreground" />
                  <span className="min-w-0 flex-1">
                    {/* The title, not "Open submission" — a list of identical
                        links tells a reviewer nothing about what they are
                        about to open. */}
                    <span className="flex flex-wrap items-center gap-2">
                      <span className="font-medium">{s.title ?? 'Untitled submission'}</span>
                      {s.work_type && <StatusBadge tone="neutral">{s.work_type}</StatusBadge>}
                      {s.version > 1 && <StatusBadge tone="info">v{s.version}</StatusBadge>}
                    </span>
                    {s.submission_link && (
                      <a
                        href={s.submission_link}
                        target="_blank"
                        rel="noreferrer noopener"
                        className="mt-0.5 flex items-center gap-1 text-xs text-primary hover:underline"
                      >
                        Open submission <ExternalLink className="size-3" />
                      </a>
                    )}
                    {/* The handover: which disk, where it is, which folder. A
                        reviewer standing at the drive cabinet needs all three. */}
                    {(s.disk_name || s.hard_disk_label || s.disk_location || s.folder_path) && (
                      <span className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
                        {(s.disk_name || s.hard_disk_label) && (
                          <span className="flex items-center gap-1">
                            <HardDrive className="size-3" aria-hidden />
                            {s.disk_name ?? s.hard_disk_label}
                            {s.disk_location ? ` · ${s.disk_location}` : ''}
                          </span>
                        )}
                        {s.folder_path && (
                          <span className="flex items-center gap-1">
                            <Folder className="size-3" aria-hidden />
                            {s.folder_path}
                          </span>
                        )}
                      </span>
                    )}
                    {s.notes && <span className="block truncate text-xs text-muted-foreground">{s.notes}</span>}
                    {s.review_notes && s.status === 'rejected' && (
                      <span className="mt-0.5 block text-xs text-destructive">Sent back: {s.review_notes}</span>
                    )}
                  </span>
                  <StatusBadge tone={TONE[s.status]}>{humanize(s.status)}</StatusBadge>
                  {canReview && s.status === 'submitted' && (
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={review.isPending}
                        onClick={() => review.mutate({ id: s.id, approve: false })}
                      >
                        Send back
                      </Button>
                      <Button size="sm" disabled={review.isPending} onClick={() => review.mutate({ id: s.id, approve: true })}>
                        Approve
                      </Button>
                    </div>
                  )}
                </CardContent>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
