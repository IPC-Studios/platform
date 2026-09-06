import { useMemo, useState, type CSSProperties, type ReactNode } from 'react'
import { Flame, Lock } from 'lucide-react'
import { toast } from 'sonner'
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
import type { CrmLead, PipelineStage } from '@ipc/contracts'
import { REQUIRED_FIELD_LABEL, missingForStage, sortStages } from '@ipc/domain'
import { StatusBadge } from '@/shared/ui/status-badge'
import { Select } from '@/shared/ui/input'
import { SkeletonCards } from '@/shared/ui/skeleton'
import { ErrorState } from '@/shared/ui/states'
import { formatINR } from '@/shared/ui/format'
import { useAccess } from '@/shared/auth/useAccess'
import { useMoveStage, usePipelines } from '../api'
import { LostReasonDialog } from '../LostReasonDialog'
import { DUE_COLUMNS, boardColumns } from '../leads'
import { BoardColumn, LeadCard, LeadTable, stageTone } from './shared'

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

/**
 * The stage board, per pipeline. Columns are the studio's own stages; a drop
 * goes through the stage-move endpoint, which enforces each stage's WIP limit
 * and required fields, and asks for a reason before a deal is lost.
 */
export function PipelineTab({ leads, onOpen }: { leads: readonly CrmLead[]; onOpen: (id: string) => void }) {
  const pipelines = usePipelines()
  const move = useMoveStage()
  const access = useAccess()
  const canEdit = access.hasAction('crm', 'edit')
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }))
  const [pick, setPick] = useState<string | null>(null)
  const [losing, setLosing] = useState<{ leadId: string; stageId: string } | null>(null)

  const list = pipelines.data ?? []
  const current = list.find((p) => p.id === pick) ?? list.find((p) => p.is_default) ?? list[0] ?? null
  const stages = useMemo(() => (current ? sortStages(current.stages) : []), [current])
  const inPipeline = useMemo(
    () => leads.filter((l) => (current ? l.pipeline_id === current.id || (l.pipeline_id === null && current.is_default) : true)),
    [leads, current],
  )
  const total = useMemo(() => inPipeline.reduce((sum, l) => sum + (l.deal_value ?? 0), 0), [inPipeline])

  function attemptMove(lead: CrmLead, stage: PipelineStage) {
    if (stage.kind === 'lost') {
      setLosing({ leadId: lead.id, stageId: stage.id })
      return
    }
    const missing = missingForStage(stage.required_fields, lead)
    if (missing.length > 0) {
      toast.error(`Fill in ${missing.map((m) => REQUIRED_FIELD_LABEL[m] ?? m).join(', ')} before moving to ${stage.name}.`)
      return
    }
    move.mutate({ leadId: lead.id, stage_id: stage.id })
  }

  function onDragEnd(e: DragEndEvent) {
    const activeId = String(e.active.id)
    const overId = e.over ? String(e.over.id) : null
    if (!overId || !overId.startsWith('stage-')) return
    const stage = stages.find((s) => s.id === overId.slice(6))
    const lead = leads.find((l) => l.id === activeId)
    if (!lead || !stage || lead.stage_id === stage.id) return
    attemptMove(lead, stage)
  }

  if (pipelines.isLoading) return <SkeletonCards count={4} />
  if (pipelines.isError || !current) {
    return <ErrorState error={pipelines.error ?? new Error('No pipeline yet.')} onRetry={() => void pipelines.refetch()} />
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-3">
        {list.length > 1 && (
          <Select value={current.id} onChange={(e) => setPick(e.target.value)} className="w-56" aria-label="Pipeline">
            {list.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
                {p.is_default ? ' (default)' : ''}
              </option>
            ))}
          </Select>
        )}
        <p className="text-sm text-muted-foreground">
          {inPipeline.length} deal{inPipeline.length === 1 ? '' : 's'} · {formatINR(total)} in {current.name}
          {canEdit ? ' · drag a card to move it' : ''}
        </p>
      </div>

      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
        <div className="grid gap-3 md:grid-cols-3 xl:grid-cols-6">
          {stages.map((s) => {
            const inStage = inPipeline.filter((l) => l.stage_id === s.id)
            const value = inStage.reduce((sum, l) => sum + (l.deal_value ?? 0), 0)
            const full = s.wip_limit !== null && inStage.length >= s.wip_limit
            return (
              <DroppableStage key={s.id} stage={s} count={inStage.length} value={value} full={full}>
                {inStage.map((l) => (
                  <DraggableLeadCard key={l.id} lead={l} onOpen={onOpen} draggable={canEdit && !move.isPending} />
                ))}
              </DroppableStage>
            )
          })}
        </div>
      </DndContext>

      <LostReasonDialog
        open={losing !== null}
        pending={move.isPending}
        onCancel={() => setLosing(null)}
        onConfirm={(d) => {
          if (!losing) return
          move.mutate({ leadId: losing.leadId, stage_id: losing.stageId, ...d }, { onSuccess: () => setLosing(null) })
        }}
      />
    </div>
  )
}

function DroppableStage({
  stage,
  count,
  value,
  full,
  children,
}: {
  stage: PipelineStage
  count: number
  value: number
  full: boolean
  children: ReactNode
}) {
  const { setNodeRef, isOver } = useDroppable({ id: `stage-${stage.id}` })
  const gate = stage.required_fields.length > 0 ? `Needs ${stage.required_fields.map((f) => REQUIRED_FIELD_LABEL[f] ?? f).join(', ')}` : null
  return (
    <div
      ref={setNodeRef}
      className={`rounded-lg border bg-card p-3 ${isOver ? (full ? 'border-destructive ring-2 ring-destructive/20' : 'border-primary ring-2 ring-primary/20') : 'border-border'}`}
    >
      <div className="flex items-center justify-between gap-2">
        <p className="truncate font-medium" title={stage.name}>
          {stage.name}
        </p>
        <span className="flex items-center gap-1">
          {stage.wip_limit !== null && (
            <StatusBadge tone={full ? 'danger' : 'neutral'}>
              {full && <Lock className="mr-1 size-3" />}
              {count}/{stage.wip_limit}
            </StatusBadge>
          )}
          {stage.wip_limit === null && <StatusBadge tone={stageTone(stage.kind)}>{count}</StatusBadge>}
        </span>
      </div>
      <p className="mt-0.5 text-xs text-muted-foreground">
        {formatINR(value)}
        {stage.kind === 'open' ? ` · ${stage.probability_default}%` : ''}
      </p>
      {gate && <p className="mt-0.5 truncate text-[0.7rem] text-muted-foreground" title={gate}>{gate}</p>}
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
          {lead.title ?? lead.name ?? 'Unnamed deal'}
        </p>
        <p className="truncate text-xs text-muted-foreground">
          {lead.title ? (lead.name ?? lead.phone ?? '—') : (lead.phone ?? '—')}
        </p>
        <p className="mt-1 flex items-center justify-between gap-2 text-xs text-muted-foreground">
          <span className="truncate">{lead.assignee_name ?? 'Unassigned'}</span>
          {lead.deal_value !== null && <span className="shrink-0 tabular-nums">{formatINR(lead.deal_value)}</span>}
        </p>
      </button>
    </div>
  )
}
