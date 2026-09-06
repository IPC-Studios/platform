import { useMemo, useState } from 'react'
import { CalendarClock, CheckCircle2, Circle, Play } from 'lucide-react'
import type { TaskListItem, TaskStatus } from '@ipc/contracts'
import { PageHeader } from '@/shared/layout/page-header'
import { FilterTabs } from '@/shared/layout/filter-tabs'
import { Button } from '@/shared/ui/button'
import { SkeletonList } from '@/shared/ui/skeleton'
import { Card, CardContent } from '@/shared/ui/card'
import { StatusBadge } from '@/shared/ui/status-badge'
import { EmptyState, ErrorState } from '@/shared/ui/states'
import { HowToUse } from '@/shared/ui/how-to-use'
import { useIsMobile } from '@/shared/hooks/use-mobile'
import { cn } from '@/shared/ui/cn'
import { useMyTasks, useUpdateMyTaskStatus } from '@/features/tasks/api'
import {
  PRIORITY_LABEL,
  STATUS_LABEL,
  TASK_TABS,
  byUrgency,
  isOverdue,
  matchesTab,
  tabCounts,
  todayISO,
  type TaskTab,
} from '@/features/tasks/board'

const STATUS_TONE: Record<TaskStatus, 'info' | 'warning' | 'success' | 'neutral'> = {
  to_do: 'neutral',
  in_progress: 'info',
  completed: 'success',
  cancelled: 'neutral',
}

const PRIORITY_TONE = {
  low: 'neutral',
  medium: 'info',
  high: 'warning',
  urgent: 'danger',
} as const

/** What the person can move a task to from where it is. */
const NEXT: Partial<Record<TaskStatus, { status: TaskStatus; label: string; icon: typeof Play }>> = {
  to_do: { status: 'in_progress', label: 'Start', icon: Play },
  in_progress: { status: 'completed', label: 'Done', icon: CheckCircle2 },
  completed: { status: 'to_do', label: 'Reopen', icon: Circle },
}

/**
 * The tasks assigned to me, and nothing else. No module gate: every member
 * has work of their own, and the API only ever returns their assignments.
 */
export function MyTasksPage() {
  return <MyTasks />
}

function MyTasks() {
  const { data, isLoading, isError, error, refetch } = useMyTasks()
  const move = useUpdateMyTaskStatus()
  const [tab, setTab] = useState<TaskTab>('all')
  const today = todayISO()
  const isMobile = useIsMobile()

  const tasks = useMemo(() => data ?? [], [data])
  const counts = useMemo(() => tabCounts(tasks, today), [tasks, today])
  const rows = useMemo(
    () => tasks.filter((t) => matchesTab(t, tab, today)).sort(byUrgency(today)),
    [tasks, tab, today],
  )

  return (
    <>
      <PageHeader title="My tasks" description="Everything assigned to you, most urgent first." />
      <HowToUse
        title="Work the list top-down"
        description="Overdue first, then what is due soonest. Start a task when you pick it up and mark it done when it is."
        steps={['Pick the top task.', 'Press Start.', 'Press Done when it is finished.']}
      />

      <FilterTabs<TaskTab>
        value={tab}
        onChange={setTab}
        tabs={TASK_TABS.map((t) => ({ ...t, count: counts[t.value] }))}
        className="mb-4 mt-6"
      />

      {isLoading ? (
        <SkeletonList rows={5} columns={5} />
      ) : isError ? (
        <ErrorState error={error} onRetry={() => void refetch()} />
      ) : rows.length === 0 ? (
        <Card>
          <CardContent className="py-4">
            <EmptyState
              title={tasks.length === 0 ? 'Nothing assigned to you yet' : 'Nothing in this view'}
              description={
                tasks.length === 0
                  ? 'When a manager assigns you a task, it will appear here.'
                  : 'Try another tab.'
              }
            />
          </CardContent>
        </Card>
      ) : isMobile ? (
        <div className="flex flex-col gap-3">
          {rows.map((t) => (
            <TaskCard key={t.id} task={t} today={today} onMove={(s) => move.mutate({ id: t.id, status: s })} busy={move.isPending} />
          ))}
        </div>
      ) : (
        <div className="table-wrap rounded-lg border border-border">
          <table className="table-sticky w-full text-sm">
            <thead className="bg-muted/50 text-left text-muted-foreground">
              <tr>
                <th className="min-w-64 px-4 py-2 font-medium">Task</th>
                <th className="px-4 py-2 font-medium">Project</th>
                <th className="px-4 py-2 font-medium">Priority</th>
                <th className="px-4 py-2 font-medium">Due</th>
                <th className="px-4 py-2 font-medium">Status</th>
                <th className="px-4 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((t) => {
                const late = isOverdue(t, today)
                const next = NEXT[t.status]
                return (
                  <tr key={t.id} className="border-t border-border hover:bg-muted/30">
                    <td className="px-4 py-2">
                      <p className="font-medium">{t.title}</p>
                      {t.description && <p className="truncate text-xs text-muted-foreground">{t.description}</p>}
                    </td>
                    <td className="px-4 py-2 text-muted-foreground">{t.project_name ?? '—'}</td>
                    <td className="px-4 py-2">
                      <StatusBadge tone={PRIORITY_TONE[t.priority]}>{PRIORITY_LABEL[t.priority]}</StatusBadge>
                    </td>
                    <td className={cn('px-4 py-2', late ? 'text-destructive' : 'text-muted-foreground')}>
                      {t.due_date ?? '—'}
                      {late && ' · overdue'}
                    </td>
                    <td className="px-4 py-2">
                      <StatusBadge tone={STATUS_TONE[t.status]}>{STATUS_LABEL[t.status]}</StatusBadge>
                    </td>
                    <td className="px-4 py-2 text-right">
                      {next && (
                        <Button size="sm" variant="outline" disabled={move.isPending} onClick={() => move.mutate({ id: t.id, status: next.status })}>
                          <next.icon /> {next.label}
                        </Button>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </>
  )
}

function TaskCard({
  task,
  today,
  onMove,
  busy,
}: {
  task: TaskListItem
  today: string
  onMove: (s: TaskStatus) => void
  busy: boolean
}) {
  const late = isOverdue(task, today)
  const next = NEXT[task.status]
  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <div className="flex items-start justify-between gap-2">
        <p className="font-medium">{task.title}</p>
        <StatusBadge tone={STATUS_TONE[task.status]}>{STATUS_LABEL[task.status]}</StatusBadge>
      </div>
      <p className="mt-1 text-sm text-muted-foreground">{task.project_name ?? 'No project'}</p>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <StatusBadge tone={PRIORITY_TONE[task.priority]}>{PRIORITY_LABEL[task.priority]}</StatusBadge>
        {task.due_date && (
          <span className={cn('flex items-center gap-1 text-xs', late ? 'text-destructive' : 'text-muted-foreground')}>
            <CalendarClock className="size-3" /> {task.due_date}
            {late && ' · overdue'}
          </span>
        )}
        {next && (
          <Button size="sm" variant="outline" className="ml-auto" disabled={busy} onClick={() => onMove(next.status)}>
            <next.icon /> {next.label}
          </Button>
        )}
      </div>
    </div>
  )
}
