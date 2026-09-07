import type { CSSProperties, ReactNode } from 'react'
import { Flame } from 'lucide-react'
import {
  DndContext,
  PointerSensor,
  closestCenter,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core'
import type { CrmLead, LeadStatus } from '@ipc/contracts'
import { StatusBadge } from '@/shared/ui/status-badge'
import { useAccess } from '@/shared/auth/useAccess'
import { useUpdateLead } from '../api'
import { DUE_COLUMNS, STAGES, boardColumns } from '../leads'
import { BoardColumn, LeadCard, LeadTable, STAGE_TONE } from './shared'

/** Everything owed today or already late — the list to clear before going home. */
export function TodayTab({ leads, now, onOpen }: { leads: readonly CrmLead[]; now: Date; onOpen: (id: string) => void }) {
  const columns = boardColumns(leads, now)
  const due = [...columns.overdue, ...columns.today]

  return (
    <div className="flex flex-col gap-4">
      <div className="rounded-lg border border-border bg-muted/30 p-4 text-sm text-muted-foreground">
        {due.length === 0
          ? 'Nothing is due today and nothing is late. '
          : `${due.length} lead${due.length === 1 ? '' : 's'} to clear today — ${columns.overdue.length} already late. `}
        Work top-down; the list is ordered by how long each one has been waiting.
      </div>
      <LeadTable leads={due} now={now} total={leads.length} onOpen={onOpen} />
    </div>
  )
}

/** The pipeline seen by when it is owed, rather than by stage. */
export function FollowUpBoardTab({ leads, now, onOpen }: { leads: readonly CrmLead[]; now: Date; onOpen: (id: string) => void }) {
  const columns = boardColumns(leads, now)
  return (
    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
      {DUE_COLUMNS.map((col) => (
        <BoardColumn
          key={col.key}
          title={col.label}
          hint={col.hint}
          count={columns[col.key].length}
          tone={col.key === 'overdue' ? 'danger' : col.key === 'today' ? 'warning' : 'neutral'}
        >
          {columns[col.key].map((l) => (
            <LeadCard key={l.id} lead={l} onOpen={onOpen} />
          ))}
        </BoardColumn>
      ))}
    </div>
  )
}

/** The classic stage board - draggable via @dnd-kit like production-board. */
export function PipelineTab({ leads, onOpen }: { leads: readonly CrmLead[]; onOpen: (id: string) => void }) {
  const patch = useUpdateLead()
  const access = useAccess()
  const canEdit = access.hasAction('crm', 'edit')
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }))

  function onDragEnd(e: DragEndEvent) {
    const activeId = String(e.active.id)
    const overId = e.over ? String(e.over.id) : null
    if (!overId) return
    const targetStage = overId.startsWith('stage-') ? (overId.slice(6) as LeadStatus) : null
    const lead = leads.find((l) => l.id === activeId)
    if (!lead || !targetStage || lead.status === targetStage) return
    patch.mutate({ id: lead.id, patch: { status: targetStage } })
  }

  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
      <div className="grid gap-3 md:grid-cols-3 xl:grid-cols-6">
        {STAGES.map((s) => {
          const inStage = leads.filter((l) => l.status === s.key)
          return (
            <DroppableStage key={s.key} stage={s.key} label={s.label} count={inStage.length} tone={STAGE_TONE[s.key]}>
              {inStage.map((l) => (
                <DraggableLeadCard key={l.id} lead={l} onOpen={onOpen} draggable={canEdit} />
              ))}
            </DroppableStage>
          )
        })}
      </div>
    </DndContext>
  )
}

function DroppableStage({
  stage,
  label,
  count,
  tone,
  children,
}: {
  stage: string
  label: string
  count: number
  tone: (typeof STAGE_TONE)[LeadStatus]
  children: ReactNode
}) {
  const { setNodeRef, isOver } = useDroppable({ id: `stage-${stage}` })
  return (
    <div ref={setNodeRef} className={`rounded-lg border bg-card p-3 ${isOver ? 'border-primary ring-2 ring-primary/20' : 'border-border'}`}>
      <div className="flex items-center justify-between gap-2">
        <p className="font-medium">{label}</p>
        <StatusBadge tone={tone}>{count}</StatusBadge>
      </div>
      <div className="mt-3 flex flex-col gap-2">
        {count === 0 ? <p className="py-4 text-center text-xs text-muted-foreground">Empty — drop here</p> : children}
      </div>
    </div>
  )
}

function DraggableLeadCard({ lead, onOpen, draggable }: { lead: CrmLead; onOpen: (id: string) => void; draggable: boolean }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({ id: lead.id, disabled: !draggable })
  const style: CSSProperties | undefined = transform
    ? { transform: `translate3d(${transform.x}px, ${transform.y}px, 0)`, opacity: isDragging ? 0.6 : 1 }
    : undefined
  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      className={`rounded-lg border border-border bg-card p-3 text-left hover:bg-accent ${draggable ? 'cursor-grab active:cursor-grabbing' : ''}`}
    >
      <button type="button" onClick={() => onOpen(lead.id)} className="w-full text-left">
        <p className="flex items-center gap-1.5 truncate text-sm font-medium">
          {lead.is_hot && <Flame className="size-3 shrink-0 text-destructive" />}
          {lead.name ?? 'Unnamed lead'}
        </p>
        <p className="truncate text-xs text-muted-foreground">{lead.phone ?? '—'}</p>
        <p className="mt-1 truncate text-xs text-muted-foreground">{lead.assignee_name ?? 'Unassigned'}</p>
      </button>
    </div>
  )
}
