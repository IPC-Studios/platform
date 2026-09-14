import { FileCheck, ExternalLink } from 'lucide-react'
import type { WorkSubmission } from '@ipc/contracts'
import { Button } from '@/shared/ui/button'
import { Card, CardContent } from '@/shared/ui/card'
import { StatusBadge } from '@/shared/ui/status-badge'
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

  return (
    <div className="mt-4 flex flex-col gap-3">
      <h2 className="text-sm font-semibold text-muted-foreground">Completed work on this project</h2>

      {isLoading ? (
        <SkeletonList rows={3} columns={3} />
      ) : isError ? (
        <ErrorState onRetry={() => void refetch()} />
      ) : !data || data.length === 0 ? (
        <EmptyState
          title="Nothing submitted yet"
          description="Work your team submits from a task or shoot will show up here for review."
        />
      ) : (
        <ul className="flex flex-col gap-2">
          {data.map((s) => (
            <li key={s.id}>
              <Card>
                <CardContent className="flex flex-wrap items-center gap-3 p-4">
                  <FileCheck className="size-4 shrink-0 text-muted-foreground" />
                  <span className="min-w-0 flex-1">
                    {s.submission_link ? (
                      <a
                        href={s.submission_link}
                        target="_blank"
                        rel="noreferrer"
                        className="flex items-center gap-1 font-medium text-primary hover:underline"
                      >
                        Open submission <ExternalLink className="size-3" />
                      </a>
                    ) : (
                      <span className="font-medium">Submission</span>
                    )}
                    {s.notes && <span className="block truncate text-xs text-muted-foreground">{s.notes}</span>}
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
