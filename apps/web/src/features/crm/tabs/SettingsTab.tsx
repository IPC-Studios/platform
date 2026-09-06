import { useEffect, useState } from 'react'
import { Link } from '@tanstack/react-router'
import { Archive, ArrowDown, ArrowUp, KanbanSquare, Megaphone, Plus, Timer, Trash2, XCircle } from 'lucide-react'
import type { CrmLead, PipelineStage, StageRequiredField } from '@ipc/contracts'
import { REQUIRED_FIELD_LABEL, sortStages } from '@ipc/domain'
import { Button } from '@/shared/ui/button'
import { Card, CardContent } from '@/shared/ui/card'
import { Input, Label, Select } from '@/shared/ui/input'
import { Skeleton } from '@/shared/ui/skeleton'
import { StatusBadge } from '@/shared/ui/status-badge'
import { useConfirm } from '@/shared/ui/confirm'
import { useAccess } from '@/shared/auth/useAccess'
import { useAuth } from '@/shared/auth/AuthProvider'
import {
  useBulkPatch,
  useCreateLostReason,
  useCreatePipeline,
  useCreateStage,
  useCrmSettings,
  useDeleteLostReason,
  useDeletePipeline,
  useDeleteStage,
  useLostReasons,
  usePipelines,
  useReorderStages,
  useUpdateCrmSettings,
  useUpdateLostReason,
  useUpdatePipeline,
  useUpdateStage,
} from '../api'

const REQUIRED_OPTIONS: StageRequiredField[] = ['deal_value', 'close_date', 'email', 'name', 'assigned_to', 'title']

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
      <PipelinesCard />
      <LostReasonsCard />
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

/**
 * The studio's pipelines and their stages. Stage moves are enforced in the
 * database (WIP limit, required fields), so what is set here is what the
 * board and the drawer obey.
 */
function PipelinesCard() {
  const { session } = useAuth()
  const isOwner = !!session?.is_owner
  const access = useAccess()
  const canEdit = access.hasAction('crm', 'edit')
  const { data, isLoading } = usePipelines()
  const createPipeline = useCreatePipeline()
  const updatePipeline = useUpdatePipeline()
  const deletePipeline = useDeletePipeline()
  const createStage = useCreateStage()
  const updateStage = useUpdateStage()
  const reorder = useReorderStages()
  const deleteStage = useDeleteStage()
  const confirm = useConfirm()
  const [pick, setPick] = useState<string | null>(null)
  const [newPipeline, setNewPipeline] = useState('')
  const [newStage, setNewStage] = useState('')
  const [editing, setEditing] = useState<string | null>(null)

  const list = data ?? []
  const current = list.find((p) => p.id === pick) ?? list.find((p) => p.is_default) ?? list[0] ?? null
  const stages = current ? sortStages(current.stages) : []

  function moveStage(index: number, dir: -1 | 1) {
    if (!current) return
    const next = [...stages]
    const target = index + dir
    if (target < 0 || target >= next.length) return
    ;[next[index], next[target]] = [next[target]!, next[index]!]
    reorder.mutate({ pipelineId: current.id, stage_ids: next.map((s) => s.id) })
  }

  async function removeStage(s: PipelineStage) {
    if (s.deal_count > 0) return
    if (await confirm({ title: `Remove the stage "${s.name}"?`, confirmLabel: 'Remove', destructive: true })) deleteStage.mutate(s.id)
  }

  async function removePipeline() {
    if (!current || current.is_default) return
    const yes = await confirm({
      title: `Delete the pipeline "${current.name}"?`,
      description: 'Its deals move to the default pipeline, stage by stage.',
      confirmLabel: 'Delete',
      destructive: true,
    })
    if (yes) deletePipeline.mutate(current.id, { onSuccess: () => setPick(null) })
  }

  return (
    <Card className="md:col-span-2">
      <CardContent className="flex flex-col gap-3 p-5">
        <p className="flex items-center gap-2 font-medium">
          <KanbanSquare className="size-4 text-muted-foreground" /> Pipelines &amp; stages
        </p>
        <p className="text-sm text-muted-foreground">
          The columns on the Pipeline View. A stage can cap how many deals sit in it and insist on fields before a deal enters.
        </p>
        {isLoading ? (
          <Skeleton className="h-24" />
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-2">
              {list.length > 1 && current && (
                <Select value={current.id} onChange={(e) => setPick(e.target.value)} className="w-56" aria-label="Pipeline">
                  {list.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                      {p.is_default ? ' (default)' : ''}
                    </option>
                  ))}
                </Select>
              )}
              {current && list.length === 1 && <span className="text-sm font-medium">{current.name}</span>}
              {current && !current.is_default && isOwner && (
                <>
                  <Button size="sm" variant="ghost" onClick={() => updatePipeline.mutate({ id: current.id, patch: { is_default: true } })}>
                    Make default
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => void removePipeline()}>
                    <Trash2 /> Delete pipeline
                  </Button>
                </>
              )}
              {isOwner && (
                <span className="ml-auto flex items-center gap-2">
                  <Input value={newPipeline} onChange={(e) => setNewPipeline(e.target.value)} placeholder="New pipeline" className="w-40" aria-label="New pipeline name" />
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={newPipeline.trim().length < 2 || createPipeline.isPending}
                    onClick={() => createPipeline.mutate({ name: newPipeline.trim(), is_default: false }, { onSuccess: (p) => { setNewPipeline(''); setPick(p.id) } })}
                  >
                    <Plus /> Add
                  </Button>
                </span>
              )}
            </div>

            {current && (
              <ul className="divide-y divide-border rounded-lg border border-border">
                {stages.map((s, i) => (
                  <li key={s.id} className="flex flex-col gap-2 p-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="flex flex-col">
                        <Button size="icon" variant="ghost" className="size-6" disabled={!canEdit || i === 0} onClick={() => moveStage(i, -1)} aria-label={`Move ${s.name} up`}>
                          <ArrowUp className="size-3" />
                        </Button>
                        <Button size="icon" variant="ghost" className="size-6" disabled={!canEdit || i === stages.length - 1} onClick={() => moveStage(i, 1)} aria-label={`Move ${s.name} down`}>
                          <ArrowDown className="size-3" />
                        </Button>
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="font-medium">{s.name}</span>
                        <span className="ml-2 text-xs text-muted-foreground">{s.key}</span>
                      </span>
                      <StatusBadge tone={s.kind === 'won' ? 'success' : s.kind === 'lost' ? 'danger' : 'info'}>{s.kind}</StatusBadge>
                      <span className="text-xs text-muted-foreground">{s.probability_default}%</span>
                      {s.wip_limit !== null && <StatusBadge tone="neutral">WIP {s.wip_limit}</StatusBadge>}
                      <span className="text-xs text-muted-foreground">{s.deal_count} deal{s.deal_count === 1 ? '' : 's'}</span>
                      {canEdit && (
                        <>
                          <Button size="sm" variant="ghost" onClick={() => setEditing(editing === s.id ? null : s.id)}>
                            {editing === s.id ? 'Done' : 'Edit'}
                          </Button>
                          <Button size="sm" variant="ghost" disabled={s.deal_count > 0} title={s.deal_count > 0 ? 'Move its deals out first' : undefined} onClick={() => void removeStage(s)}>
                            <Trash2 />
                            <span className="sr-only">Remove {s.name}</span>
                          </Button>
                        </>
                      )}
                    </div>
                    {editing === s.id && <StageEditor stage={s} onSave={(patch) => updateStage.mutate({ id: s.id, patch })} pending={updateStage.isPending} />}
                  </li>
                ))}
              </ul>
            )}

            {current && canEdit && (
              <div className="flex flex-wrap items-center gap-2">
                <Input value={newStage} onChange={(e) => setNewStage(e.target.value)} placeholder="New stage, e.g. Negotiation" className="w-56" aria-label="New stage name" />
                <Button
                  size="sm"
                  variant="outline"
                  disabled={!newStage.trim() || createStage.isPending}
                  onClick={() => createStage.mutate({ pipelineId: current.id, name: newStage.trim(), kind: 'open', required_fields: [] }, { onSuccess: () => setNewStage('') })}
                >
                  <Plus /> Add stage
                </Button>
                <span className="text-xs text-muted-foreground">New stages go before Won and Lost; use the arrows to place them.</span>
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  )
}

function StageEditor({ stage, onSave, pending }: { stage: PipelineStage; onSave: (patch: { name?: string; probability_default?: number; wip_limit?: number | null; required_fields?: StageRequiredField[] }) => void; pending: boolean }) {
  const [name, setName] = useState(stage.name)
  const [prob, setProb] = useState(String(stage.probability_default))
  const [wip, setWip] = useState(stage.wip_limit === null ? '' : String(stage.wip_limit))
  const [required, setRequired] = useState<StageRequiredField[]>(stage.required_fields)
  const toggle = (f: StageRequiredField) => setRequired((r) => (r.includes(f) ? r.filter((x) => x !== f) : [...r, f]))
  const p = Number(prob)
  const w = wip === '' ? null : Number(wip)
  const valid = name.trim().length > 0 && Number.isInteger(p) && p >= 0 && p <= 100 && (w === null || (Number.isInteger(w) && w >= 1 && w <= 1000))
  return (
    <div className="grid gap-3 rounded-lg bg-muted/30 p-3 sm:grid-cols-3">
      <div className="flex flex-col gap-1">
        <Label htmlFor={`st-name-${stage.id}`}>Name</Label>
        <Input id={`st-name-${stage.id}`} value={name} onChange={(e) => setName(e.target.value)} />
      </div>
      <div className="flex flex-col gap-1">
        <Label htmlFor={`st-prob-${stage.id}`}>Default probability %</Label>
        <Input id={`st-prob-${stage.id}`} type="number" min={0} max={100} value={prob} onChange={(e) => setProb(e.target.value)} disabled={stage.kind !== 'open'} />
      </div>
      <div className="flex flex-col gap-1">
        <Label htmlFor={`st-wip-${stage.id}`}>WIP limit</Label>
        <Input id={`st-wip-${stage.id}`} type="number" min={1} max={1000} value={wip} onChange={(e) => setWip(e.target.value)} placeholder="No limit" />
      </div>
      {stage.kind === 'open' && (
        <div className="flex flex-col gap-1 sm:col-span-3">
          <Label>Required before entering</Label>
          <div className="flex flex-wrap gap-2">
            {REQUIRED_OPTIONS.map((f) => (
              <button
                key={f}
                type="button"
                aria-pressed={required.includes(f)}
                onClick={() => toggle(f)}
                className={`rounded-full border px-2.5 py-1 text-xs ${required.includes(f) ? 'border-primary bg-primary/10 text-primary' : 'border-border text-muted-foreground'}`}
              >
                {REQUIRED_FIELD_LABEL[f] ?? f}
              </button>
            ))}
          </div>
        </div>
      )}
      <div className="sm:col-span-3">
        <Button size="sm" disabled={!valid || pending} onClick={() => onSave({ name: name.trim(), probability_default: p, wip_limit: w, required_fields: required })}>
          Save stage
        </Button>
      </div>
    </div>
  )
}

/** The picklist offered whenever a deal is marked lost. */
function LostReasonsCard() {
  const access = useAccess()
  const canEdit = access.hasAction('crm', 'edit')
  const { data, isLoading } = useLostReasons()
  const create = useCreateLostReason()
  const update = useUpdateLostReason()
  const remove = useDeleteLostReason()
  const [label, setLabel] = useState('')
  return (
    <Card>
      <CardContent className="flex flex-col gap-3 p-5">
        <p className="flex items-center gap-2 font-medium">
          <XCircle className="size-4 text-muted-foreground" /> Lost reasons
        </p>
        <p className="text-sm text-muted-foreground">Every lost deal picks one of these, so the lost analysis in Reports means something.</p>
        {isLoading ? (
          <Skeleton className="h-20" />
        ) : (
          <ul className="flex flex-wrap gap-2">
            {(data ?? []).map((r) => (
              <li key={r.id} className={`flex items-center gap-1 rounded-full border border-border py-1 pl-3 pr-1 text-sm ${r.is_active ? '' : 'opacity-50'}`}>
                <span>{r.label}</span>
                {canEdit && (
                  <>
                    <button type="button" className="rounded-full px-1.5 text-xs text-muted-foreground hover:text-foreground" onClick={() => update.mutate({ id: r.id, patch: { is_active: !r.is_active } })}>
                      {r.is_active ? 'hide' : 'show'}
                    </button>
                    <button type="button" className="rounded-full p-0.5 text-muted-foreground hover:text-destructive" onClick={() => remove.mutate(r.id)} aria-label={`Remove ${r.label}`}>
                      <Trash2 className="size-3" />
                    </button>
                  </>
                )}
              </li>
            ))}
          </ul>
        )}
        {canEdit && (
          <div className="flex items-center gap-2">
            <Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Add a reason" className="w-48" aria-label="New lost reason" />
            <Button size="sm" variant="outline" disabled={label.trim().length < 3 || create.isPending} onClick={() => create.mutate({ label: label.trim() }, { onSuccess: () => setLabel('') })}>
              <Plus /> Add
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
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
