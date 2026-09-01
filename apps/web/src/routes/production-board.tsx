import { useEffect, useMemo, useState } from 'react'
import {
  DndContext,
  PointerSensor,
  useSensor,
  useSensors,
  closestCorners,
  type DragEndEvent,
} from '@dnd-kit/core'
import {
  SortableContext,
  useSortable,
  arrayMove,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { useDroppable } from '@dnd-kit/core'
import type { TaskListItem, TaskStatus } from '@ipc/contracts'
import { AuthedPage } from '@/shared/layout/AuthedPage'
import { PageHeader } from '@/shared/layout/page-header'
import { StatusBadge } from '@/shared/ui/status-badge'
import { SkeletonCards } from '@/shared/ui/skeleton'
import { ErrorState } from '@/shared/ui/states'
import { useBoard, useSetBoardOrder, useUpdateTaskStatus } from '@/features/tasks/api'

const LANES: { key: TaskStatus; label: string }[] = [
  { key: 'to_do', label: 'To do' },
  { key: 'in_progress', label: 'In progress' },
  { key: 'completed', label: 'Completed' },
  { key: 'cancelled', label: 'Cancelled' },
]

const PRIORITY_TONE: Record<string, 'danger' | 'warning' | 'info' | 'neutral'> = {
  urgent: 'danger',
  high: 'warning',
  medium: 'info',
  low: 'neutral',
}

type Lanes = Record<TaskStatus, TaskListItem[]>

export function ProductionBoardPage() {
  return (
    <AuthedPage module="tasks">
      <Board />
    </AuthedPage>
  )
}

function groupByLane(items: TaskListItem[]): Lanes {
  const lanes: Lanes = { to_do: [], in_progress: [], completed: [], cancelled: [] }
  for (const t of items) lanes[t.status].push(t)
  for (const key of Object.keys(lanes) as TaskStatus[]) {
    lanes[key].sort((a, b) => a.sort_order - b.sort_order)
  }
  return lanes
}

function Board() {
  const { data, isLoading, isError, refetch } = useBoard()
  const setOrder = useSetBoardOrder()
  const updateStatus = useUpdateTaskStatus()
  const [lanes, setLanes] = useState<Lanes>(() => groupByLane([]))

  useEffect(() => {
    if (data) setLanes(groupByLane(data))
  }, [data])

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }))
  const laneOf = useMemo(() => {
    const m = new Map<string, TaskStatus>()
    for (const key of Object.keys(lanes) as TaskStatus[]) for (const t of lanes[key]) m.set(t.id, key)
    return m
  }, [lanes])

  function onDragEnd(e: DragEndEvent) {
    const activeId = String(e.active.id)
    if (!e.over) return
    const overId = String(e.over.id)
    const from = laneOf.get(activeId)
    if (!from) return
    // over is either a card id or a lane droppable id ("lane:<status>")
    const to = overId.startsWith('lane:') ? (overId.slice(5) as TaskStatus) : laneOf.get(overId)
    if (!to) return

    setLanes((prev) => {
      const next: Lanes = {
        to_do: [...prev.to_do],
        in_progress: [...prev.in_progress],
        completed: [...prev.completed],
        cancelled: [...prev.cancelled],
      }
      const idx = next[from].findIndex((t) => t.id === activeId)
      if (idx === -1) return prev

      if (from === to) {
        const overIdx = next[to].findIndex((t) => t.id === overId)
        if (overIdx !== -1 && overIdx !== idx) next[to] = arrayMove(next[to], idx, overIdx)
      } else {
        const [moved] = next[from].splice(idx, 1)
        if (!moved) return prev
        const overIdx = next[to].findIndex((t) => t.id === overId)
        const insertAt = overIdx === -1 ? next[to].length : overIdx
        next[to].splice(insertAt, 0, { ...moved, status: to })
      }

      // Persist: target lane order (+ source lane if changed) and the status move.
      void setOrder.mutateAsync({
        board_view: 'default',
        lane_key: to,
        task_ids: next[to].map((t) => t.id),
      })
      if (from !== to) {
        void setOrder.mutateAsync({
          board_view: 'default',
          lane_key: from,
          task_ids: next[from].map((t) => t.id),
        })
        void updateStatus.mutateAsync({ id: activeId, status: to })
      }
      return next
    })
  }

  if (isLoading) return <SkeletonCards count={3} />
  if (isError) return <ErrorState onRetry={() => void refetch()} />

  return (
    <>
      <PageHeader title="Production board" description="Drag cards to reorder or change stage." />
      <DndContext sensors={sensors} collisionDetection={closestCorners} onDragEnd={onDragEnd}>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
          {LANES.map((lane) => (
            <Lane key={lane.key} laneKey={lane.key} label={lane.label} tasks={lanes[lane.key]} />
          ))}
        </div>
      </DndContext>
    </>
  )
}

function Lane({ laneKey, label, tasks }: { laneKey: TaskStatus; label: string; tasks: TaskListItem[] }) {
  const { setNodeRef, isOver } = useDroppable({ id: `lane:${laneKey}` })
  return (
    <div
      ref={setNodeRef}
      className={`flex min-h-40 flex-col gap-2 rounded-lg border p-3 transition-colors ${
        isOver ? 'border-primary bg-primary/5' : 'border-border bg-muted/30'
      }`}
    >
      <div className="flex items-center justify-between px-1">
        <span className="text-sm font-medium">{label}</span>
        <span className="text-xs text-muted-foreground">{tasks.length}</span>
      </div>
      <SortableContext items={tasks.map((t) => t.id)} strategy={verticalListSortingStrategy}>
        {tasks.map((t) => (
          <TaskCard key={t.id} task={t} />
        ))}
      </SortableContext>
    </div>
  )
}

function TaskCard({ task }: { task: TaskListItem }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: task.id,
  })
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={`cursor-grab rounded-md border border-border bg-card p-3 shadow-sm ${
        isDragging ? 'opacity-50' : ''
      }`}
      {...attributes}
      {...listeners}
    >
      <div className="flex items-start justify-between gap-2">
        <p className="text-sm font-medium">{task.title}</p>
        <StatusBadge tone={PRIORITY_TONE[task.priority]}>{task.priority}</StatusBadge>
      </div>
      {task.project_name && (
        <p className="mt-1 text-xs text-muted-foreground">{task.project_name}</p>
      )}
    </div>
  )
}
