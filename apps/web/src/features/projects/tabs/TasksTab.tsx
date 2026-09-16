import { Link } from '@tanstack/react-router'
import { CheckSquare, Plus } from 'lucide-react'
import type { TaskStatus } from '@ipc/contracts'
import { Button } from '@/shared/ui/button'
import { Card, CardContent } from '@/shared/ui/card'
import { Select } from '@/shared/ui/input'
import { StatusBadge } from '@/shared/ui/status-badge'
import { SkeletonList } from '@/shared/ui/skeleton'
import { ErrorState, EmptyState } from '@/shared/ui/states'
import { humanize } from '@/shared/ui/format'
import { useProjectTasks, useUpdateTaskStatus } from '@/features/tasks/api'

const TONE: Record<TaskStatus, 'neutral' | 'info' | 'success' | 'danger'> = {
  to_do: 'neutral',
  in_progress: 'info',
  completed: 'success',
  cancelled: 'danger',
}

/** This project's own tasks — a real tab instead of a link away to the global board. */
export function TasksTab({ projectId, canEdit }: { projectId: string; canEdit: boolean }) {
  const { data, isLoading, isError, refetch } = useProjectTasks(projectId)
  const updateStatus = useUpdateTaskStatus()

  return (
    <div className="mt-4 flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-sm font-semibold text-muted-foreground">Tasks on this project</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Work that comes from a deliverable is tagged as such. Add one here only for the extras — a
            last-minute client request, an urgent re-edit, a one-off bit of coordination.
          </p>
        </div>
        <Button variant="outline" size="sm" asChild>
          <Link to="/tasks">
            <Plus /> Add task
          </Link>
        </Button>
      </div>

      {isLoading ? (
        <SkeletonList rows={3} columns={3} />
      ) : isError ? (
        <ErrorState onRetry={() => void refetch()} />
      ) : !data || data.length === 0 ? (
        <EmptyState
          title="No tasks yet"
          description="Break this project's work into tasks your team can pick up."
          action={
            <Button variant="outline" size="sm" asChild>
              <Link to="/tasks">
                <Plus /> Add task
              </Link>
            </Button>
          }
        />
      ) : (
        <ul className="flex flex-col gap-2">
          {data.map((t) => (
            <li key={t.id}>
              <Card>
                <CardContent className="flex flex-wrap items-center gap-3 p-4">
                  <span className="flex min-w-0 flex-1 items-center gap-2">
                    <CheckSquare className="size-4 shrink-0 text-muted-foreground" />
                    <span className="min-w-0 truncate font-medium">{t.title}</span>
                    {/* Which of these is the studio's own promise to the
                        client, and which is an extra someone added. */}
                    {t.deliverable_id && <StatusBadge tone="info">From deliverable</StatusBadge>}
                  </span>
                  {t.custom_priority_label ? (
                    <StatusBadge tone={t.custom_priority_tone ?? 'neutral'}>{t.custom_priority_label}</StatusBadge>
                  ) : (
                    <StatusBadge tone="neutral">{humanize(t.priority)}</StatusBadge>
                  )}
                  {t.due_date && <span className="text-xs text-muted-foreground">Due {t.due_date}</span>}
                  {t.assignee_names.length > 0 && (
                    <span className="text-xs text-muted-foreground">{t.assignee_names.join(', ')}</span>
                  )}
                  {canEdit ? (
                    <Select
                      value={t.status}
                      onChange={(e) => updateStatus.mutate({ id: t.id, status: e.target.value as TaskStatus })}
                      className="w-36"
                      aria-label={`Status for ${t.title}`}
                    >
                      <option value="to_do">To do</option>
                      <option value="in_progress">In progress</option>
                      <option value="completed">Completed</option>
                      <option value="cancelled">Cancelled</option>
                    </Select>
                  ) : (
                    <StatusBadge tone={TONE[t.status]}>{humanize(t.status)}</StatusBadge>
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
