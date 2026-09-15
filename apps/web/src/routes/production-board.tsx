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
import { Link } from '@tanstack/react-router'
import { toast } from 'sonner'
import { CalendarDays, Check, ChevronDown, ChevronRight, Package, Search, Users, X } from 'lucide-react'
import type { TaskListItem, TaskStatus } from '@ipc/contracts'
import { AuthedPage } from '@/shared/layout/AuthedPage'
import { PageHeader } from '@/shared/layout/page-header'
import { Button } from '@/shared/ui/button'
import { Card, CardContent } from '@/shared/ui/card'
import { Input, Select } from '@/shared/ui/input'
import { StatusBadge } from '@/shared/ui/status-badge'
import { SkeletonCards } from '@/shared/ui/skeleton'
import { ErrorState, EmptyState } from '@/shared/ui/states'
import { cn } from '@/shared/ui/cn'
import { useBoard, useSetBoardOrder, useUpdateTaskStatus } from '@/features/tasks/api'
import { useBoardDeliverables, type BoardDeliverable } from '@/features/projects/api'

/**
 * Lane configuration: the four task stages plus the attention lenses the
 * studio triages by. Stages are the drag destinations; lenses only filter.
 */
const LANES: { key: TaskStatus; label: string; hint: string }[] = [
  { key: 'to_do', label: 'To do', hint: 'Not started yet' },
  { key: 'in_progress', label: 'In progress', hint: 'Being worked on' },
  { key: 'completed', label: 'Completed', hint: 'Done and approved' },
  { key: 'cancelled', label: 'Cancelled', hint: 'Dropped work' },
]

/**
 * Lovable parity: the seven production buckets (unassigned → sent to client).
 * Task rows only carry the four stages above, so each bucket maps onto the
 * stage its cards live in; deliverables (which carry their own board_status)
 * group under these buckets directly in the strip below the filters.
 */
const LOVABLE_LANES_7: { key: string; label: string; stage: TaskStatus | null; hint: string }[] = [
  { key: 'unassigned', label: 'Unassigned', stage: 'to_do', hint: 'No owner yet' },
  { key: 'assigned', label: 'Assigned / Not Started', stage: 'to_do', hint: 'Waiting to start' },
  { key: 'in_progress', label: 'In Progress', stage: 'in_progress', hint: 'Being worked on' },
  { key: 'pending_review', label: 'Pending Review', stage: 'in_progress', hint: 'Waiting for review' },
  { key: 'revision_required', label: 'Revision Required', stage: 'in_progress', hint: 'Changes requested' },
  { key: 'completed', label: 'Completed / Approved', stage: 'completed', hint: 'Done and approved' },
  { key: 'sent_to_client', label: 'Sent to Client', stage: 'completed', hint: 'Delivered to client' },
]

type BoardView = 'status' | 'people' | 'data'

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
  const [view, setView] = useState<BoardView>('status')
  const [search, setSearch] = useState('')
  const [project, setProject] = useState('all')
  const [priority, setPriority] = useState('all')
  const [assignee, setAssignee] = useState('all')
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set())
  const [lanes, setLanes] = useState<Lanes>(() => groupByLane([]))

  const projectOptions = useMemo(() => {
    const m = new Map<string, string>()
    for (const t of data ?? []) if (t.project_id) m.set(t.project_id, t.project_name ?? t.project_id)
    return [...m.entries()].sort((a, b) => a[1].localeCompare(b[1]))
  }, [data])

  const assigneeOptions = useMemo(() => {
    const s = new Set<string>()
    for (const t of data ?? []) for (const n of t.assignee_names) s.add(n)
    return [...s].sort()
  }, [data])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return (data ?? []).filter((t) => {
      if (project !== 'all' && t.project_id !== project) return false
      if (priority !== 'all' && t.priority !== priority) return false
      if (assignee !== 'all' && !t.assignee_names.includes(assignee)) return false
      if (q && !`${t.title} ${t.project_name ?? ''}`.toLowerCase().includes(q)) return false
      return true
    })
  }, [data, search, project, priority, assignee])

  // Selection never points at rows the filters have hidden.
  const visibleIds = useMemo(() => new Set(filtered.map((t) => t.id)), [filtered])
  useEffect(() => {
    setSelected((prev) => {
      if (prev.size === 0) return prev
      const next = new Set([...prev].filter((id) => visibleIds.has(id)))
      return next.size === prev.size ? prev : next
    })
  }, [visibleIds])

  const toggleSelect = (id: string) =>
    setSelected((s) => {
      const next = new Set(s)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  async function bulkStatus(status: TaskStatus) {
    const ids = [...selected]
    if (ids.length === 0) return
    try {
      await Promise.all(ids.map((taskId) => updateStatus.mutateAsync({ id: taskId, status })))
      toast.success(`${ids.length} task${ids.length === 1 ? '' : 's'} moved`)
      setSelected(new Set())
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not move every task.')
    }
  }

  useEffect(() => {
    if (data) setLanes(groupByLane(filtered))
  }, [data, filtered])

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

  const total = filtered.length
  const unassigned = filtered.filter((t) => t.assignee_names.length === 0).length
  const overdue = filtered.filter((t) => t.due_date && t.due_date < new Date().toISOString().slice(0, 10) && t.status !== 'completed' && t.status !== 'cancelled').length

  return (
    <>
      <PageHeader title="Production board" description="Drag cards to reorder or change stage." />

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <div className="inline-flex rounded-lg border border-border bg-card p-0.5 text-xs" role="tablist" aria-label="Board view">
          {(['status', 'people', 'data'] as BoardView[]).map((v) => (
            <button
              key={v}
              type="button"
              role="tab"
              aria-selected={view === v}
              onClick={() => setView(v)}
              className={cn(
                'rounded-md px-3 py-1.5 font-medium capitalize transition-colors',
                view === v ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {v === 'status' ? 'Status' : v === 'people' ? 'People' : 'Data'}
            </button>
          ))}
        </div>
        <span className="text-xs text-muted-foreground">
          {total} card{total === 1 ? '' : 's'}
          {unassigned > 0 && ` · ${unassigned} unassigned`}
          {overdue > 0 && ` · ${overdue} overdue`}
        </span>
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        <label className="relative w-full sm:w-64">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search title or project…" aria-label="Search board" className="pl-9" />
        </label>
        <Select value={project} onChange={(e) => setProject(e.target.value)} aria-label="Filter by project" className="w-44">
          <option value="all">All projects</option>
          {projectOptions.map(([pid, name]) => <option key={pid} value={pid}>{name}</option>)}
        </Select>
        <Select value={priority} onChange={(e) => setPriority(e.target.value)} aria-label="Filter by priority" className="w-36">
          <option value="all">Any priority</option>
          <option value="urgent">Urgent</option>
          <option value="high">High</option>
          <option value="medium">Medium</option>
          <option value="low">Low</option>
        </Select>
        <Select value={assignee} onChange={(e) => setAssignee(e.target.value)} aria-label="Filter by assignee" className="w-44">
          <option value="all">Any assignee</option>
          {assigneeOptions.map((n) => <option key={n} value={n}>{n}</option>)}
        </Select>
        {(search || project !== 'all' || priority !== 'all' || assignee !== 'all') && (
          <Button variant="ghost" size="sm" onClick={() => { setSearch(''); setProject('all'); setPriority('all'); setAssignee('all') }}>
            <X /> Clear
          </Button>
        )}
      </div>

      <DeliverablesStrip />

      {selected.size > 0 && (
        <div className="mt-3 flex flex-wrap items-center gap-2 rounded-lg border border-primary/30 bg-primary/5 px-3 py-2 text-sm">
          <span className="font-medium">{selected.size} selected</span>
          <span className="text-xs text-muted-foreground">Move to:</span>
          {LANES.map((l) => (
            <Button key={l.key} size="sm" variant="outline" disabled={updateStatus.isPending} onClick={() => void bulkStatus(l.key)}>
              {l.label}
            </Button>
          ))}
          <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>Clear</Button>
        </div>
      )}

      {view === 'people' ? (
        <PeopleView tasks={filtered} />
      ) : view === 'data' ? (
        <DataView tasks={filtered} />
      ) : (
      <DndContext sensors={sensors} collisionDetection={closestCorners} onDragEnd={onDragEnd}>
        <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
          {LANES.map((lane) => (
            <Lane key={lane.key} laneKey={lane.key} label={lane.label} hint={lane.hint} tasks={lanes[lane.key]} selected={selected} onToggleSelect={toggleSelect} />
          ))}
        </div>
      </DndContext>
      )}
    </>
  )
}

/**
 * Deliverable cards across every project, grouped under the seven Lovable
 * buckets. Tasks are the drag destinations above; this strip answers "what is
 * promised and where is it" without leaving the board.
 */
function DeliverablesStrip() {
  const { data, isLoading } = useBoardDeliverables()
  const [open, setOpen] = useState(false)

  const groups = useMemo(() => {
    const m = new Map<string, BoardDeliverable[]>()
    for (const d of data ?? []) {
      const bucket = (d.board_status ?? d.status ?? 'unassigned').toLowerCase()
      m.set(bucket, [...(m.get(bucket) ?? []), d])
    }
    return LOVABLE_LANES_7.map((lane) => ({
      lane,
      items: m.get(lane.key) ?? [],
    })).filter((g) => g.items.length > 0)
  }, [data])

  const total = (data ?? []).length
  if (isLoading || total === 0) return null

  return (
    <Card className="mt-3">
      <CardContent className="p-3">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          className="flex w-full items-center gap-2 rounded-md px-1 py-1 text-left text-sm font-medium transition-colors hover:bg-accent"
        >
          {open ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
          <Package className="size-4 text-muted-foreground" aria-hidden />
          Deliverables on the board ({total})
          <span className="ml-1 flex flex-wrap gap-1">
            {groups.map((g) => (
              <StatusBadge key={g.lane.key} tone="neutral">
                {g.lane.label} · {g.items.length}
              </StatusBadge>
            ))}
          </span>
        </button>
        {open && (
          <div className="mt-2 grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
            {groups.map((g) => (
              <div key={g.lane.key} className="flex flex-col gap-1.5 rounded-lg border border-border bg-muted/30 p-2.5">
                <p className="px-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground" title={g.lane.hint}>
                  {g.lane.label} ({g.items.length})
                </p>
                {g.items.slice(0, 6).map((d) => (
                  <div key={d.id} className="rounded-md border border-border bg-card p-2.5">
                    <p className="truncate text-sm font-medium" title={d.title}>{d.title}</p>
                    <p className="mt-0.5 truncate text-xs text-muted-foreground">
                      {d.project_name ?? 'No project'}
                      {d.shoot_name ? ` · ${d.shoot_name}` : ''}
                      {d.due_date ? ` · due ${d.due_date}` : ''}
                    </p>
                    {d.project_id && (
                      <Link
                        to="/projects/$id"
                        params={{ id: d.project_id }}
                        className="mt-1 inline-block text-xs font-medium text-primary hover:underline"
                      >
                        Open project
                      </Link>
                    )}
                  </div>
                ))}
                {g.items.length > 6 && (
                  <p className="px-1 text-xs text-muted-foreground">+ {g.items.length - 6} more</p>
                )}
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  )
}

function PeopleView({ tasks }: { tasks: TaskListItem[] }) {
  const lanes = useMemo(() => {
    const m = new Map<string, TaskListItem[]>()
    m.set('Unassigned', [])
    for (const t of tasks) {
      if (t.assignee_names.length === 0) m.get('Unassigned')!.push(t)
      else for (const n of t.assignee_names) m.set(n, [...(m.get(n) ?? []), t])
    }
    return [...m.entries()].sort((a, b) => (a[0] === 'Unassigned' ? -1 : b[0] === 'Unassigned' ? 1 : b[1].length - a[1].length || a[0].localeCompare(b[0])))
  }, [tasks])
  if (tasks.length === 0) return <EmptyState title="Nothing here" description="No cards match these filters." />
  return (
    <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
      {lanes.map(([name, items]) => (
        <div key={name} className="flex flex-col gap-2 rounded-lg border border-border bg-muted/30 p-3">
          <div className="flex items-center justify-between px-1">
            <span className="flex items-center gap-1.5 text-sm font-medium"><Users className="size-4 text-muted-foreground" />{name}</span>
            <span className="text-xs text-muted-foreground">{items.length}</span>
          </div>
          {items.map((t) => (
            <div key={t.id} className="rounded-md border border-border bg-card p-3 shadow-sm">
              <p className="text-sm font-medium">{t.title}</p>
              {t.project_name && <p className="mt-0.5 text-xs text-muted-foreground">{t.project_name}</p>}
            </div>
          ))}
        </div>
      ))}
    </div>
  )
}

function DataView({ tasks }: { tasks: TaskListItem[] }) {
  const today = new Date().toISOString().slice(0, 10)
  const overdue = tasks.filter((t) => t.due_date && t.due_date < today && t.status !== 'completed' && t.status !== 'cancelled')
  const dueWeek = tasks.filter((t) => t.due_date && t.due_date >= today && t.due_date <= today.slice(0, 8) + '31')
  const unassigned = tasks.filter((t) => t.assignee_names.length === 0 && t.status !== 'completed' && t.status !== 'cancelled')
  return (
    <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-3">
      <div className="rounded-lg border border-border bg-card p-4">
        <p className="text-sm font-semibold text-destructive">Overdue ({overdue.length})</p>
        <ul className="mt-2 flex flex-col gap-1.5 text-sm">
          {overdue.slice(0, 8).map((t) => (
            <li key={t.id} className="truncate">{t.title} <span className="text-xs text-muted-foreground">· due {t.due_date}</span></li>
          ))}
          {overdue.length === 0 && <li className="text-sm text-muted-foreground">Nothing late.</li>}
        </ul>
      </div>
      <div className="rounded-lg border border-border bg-card p-4">
        <p className="text-sm font-semibold">Due this month ({dueWeek.length})</p>
        <ul className="mt-2 flex flex-col gap-1.5 text-sm">
          {dueWeek.slice(0, 8).map((t) => (
            <li key={t.id} className="truncate">{t.title} <span className="text-xs text-muted-foreground">· due {t.due_date}</span></li>
          ))}
          {dueWeek.length === 0 && <li className="text-sm text-muted-foreground">Nothing due.</li>}
        </ul>
      </div>
      <div className="rounded-lg border border-border bg-card p-4">
        <p className="text-sm font-semibold">Needs an owner ({unassigned.length})</p>
        <ul className="mt-2 flex flex-col gap-1.5 text-sm">
          {unassigned.slice(0, 8).map((t) => (
            <li key={t.id} className="truncate">{t.title} <span className="text-xs text-muted-foreground">· {t.project_name ?? 'no project'}</span></li>
          ))}
          {unassigned.length === 0 && <li className="text-sm text-muted-foreground">Everything has an owner.</li>}
        </ul>
      </div>
    </div>
  )
}

function Lane({ laneKey, label, hint, tasks, selected, onToggleSelect }: { laneKey: TaskStatus; label: string; hint: string; tasks: TaskListItem[]; selected: ReadonlySet<string>; onToggleSelect: (id: string) => void }) {
  const { setNodeRef, isOver } = useDroppable({ id: `lane:${laneKey}` })
  return (
    <div
      ref={setNodeRef}
      className={`flex min-h-40 flex-col gap-2 rounded-lg border p-3 transition-colors ${
        isOver ? 'border-primary bg-primary/5' : 'border-border bg-muted/30'
      }`}
    >
      <div className="flex items-center justify-between px-1">
        <span className="text-sm font-medium" title={hint}>{label}</span>
        <span className="text-xs text-muted-foreground">{tasks.length}</span>
      </div>
      <SortableContext items={tasks.map((t) => t.id)} strategy={verticalListSortingStrategy}>
        {tasks.map((t) => (
          <TaskCard key={t.id} task={t} ticked={selected.has(t.id)} onToggle={() => onToggleSelect(t.id)} />
        ))}
      </SortableContext>
    </div>
  )
}

function TaskCard({ task, ticked, onToggle }: { task: TaskListItem; ticked: boolean; onToggle: () => void }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: task.id,
  })
  const overdue = !!task.due_date && task.due_date < new Date().toISOString().slice(0, 10) && task.status !== 'completed' && task.status !== 'cancelled'
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={`cursor-grab rounded-md border border-border bg-card p-3 shadow-sm ${
        isDragging ? 'opacity-50' : ''
      } ${ticked ? 'ring-2 ring-primary/50' : ''}`}
      {...attributes}
      {...listeners}
    >
      <div className="flex items-start justify-between gap-2">
        <span className="flex min-w-0 items-start gap-1.5">
          <button
            type="button"
            role="checkbox"
            aria-checked={ticked}
            aria-label={`Select ${task.title}`}
            onClick={(e) => { e.stopPropagation(); onToggle() }}
            onPointerDown={(e) => e.stopPropagation()}
            className={cn(
              'mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full border transition-colors',
              ticked ? 'border-primary bg-primary text-primary-foreground' : 'border-input hover:border-primary/50',
            )}
          >
            {ticked && <Check className="size-2.5" aria-hidden />}
          </button>
          <p className="min-w-0 text-sm font-medium">{task.title}</p>
        </span>
        <StatusBadge tone={PRIORITY_TONE[task.priority]}>{task.priority}</StatusBadge>
      </div>
      {task.project_name && (
        <p className="mt-1 text-xs text-muted-foreground">{task.project_name}</p>
      )}
      <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-muted-foreground">
        {task.due_date && (
          <span className={cn('flex items-center gap-1', overdue && 'font-medium text-destructive')}>
            <CalendarDays className="size-3" /> {task.due_date}{overdue ? ' · overdue' : ''}
          </span>
        )}
        {task.assignee_names.length > 0 && (
          <span className="flex items-center gap-1">
            <Users className="size-3" /> {task.assignee_names.slice(0, 2).join(', ')}
            {task.assignee_names.length > 2 ? ` +${task.assignee_names.length - 2}` : ''}
          </span>
        )}
      </div>
    </div>
  )
}
