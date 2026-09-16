import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import {
  AlertTriangle,
  Camera,
  Clock,
  Database,
  ExternalLink,
  MapPin,
  Pencil,
  Plus,
  Sparkles,
  Trash2,
  UserPlus,
  Users,
} from 'lucide-react'
import { toast } from 'sonner'
import {
  createShootRequest,
  shootListItem,
  type ShootListItem,
  type ShootRequirementInput,
  type ShootStatus,
  type TeamSlot,
} from '@ipc/contracts'
import { callApi } from '@/shared/api/client'
import { useAuth } from '@/shared/auth/AuthProvider'
import { useAccess } from '@/shared/auth/useAccess'
import { Button } from '@/shared/ui/button'
import { Card, CardContent } from '@/shared/ui/card'
import { Input, Label, Select } from '@/shared/ui/input'
import { Dialog, DialogContent } from '@/shared/ui/dialog'
import { StatusBadge } from '@/shared/ui/status-badge'
import { SkeletonList } from '@/shared/ui/skeleton'
import { ErrorState, EmptyState } from '@/shared/ui/states'
import { cn } from '@/shared/ui/cn'
import { humanize, formatINR } from '@/shared/ui/format'
import { useConfirm } from '@/shared/ui/confirm'
import { useShootTypes } from '@/features/projects/api'
import { useDeleteShoot, useServices, useShootPresets, useUpdateShoot } from '@/features/shoots/api'
import { useBookSlot, useMembers, useSlots } from '@/features/allocation/api'
import { useDataRecords } from '@/features/data/api'

/**
 * The shoots a wedding studio books over and over. Used as one-click chips so
 * the common case is a single tap — the studio's own saved types take
 * precedence when it has any.
 */
const QUICK_SHOOTS = [
  'Engagement',
  'Haldi',
  'Mehendi',
  'Sangeet',
  'Wedding',
  'Reception',
  'Pre-Wedding',
  'Cocktail',
  'Bride Getting Ready',
  'Groom Getting Ready',
] as const

/** The crew roles a studio reaches for, when it has not named its own yet. */
const FALLBACK_ROLES = [
  'Traditional Photographer',
  'Candid Photographer',
  'Traditional Videographer',
  'Cinematographer',
  'Drone Operator',
  'Assistant Photographer',
  'BTS Shooter',
] as const

const todayISO = () => new Date().toISOString().slice(0, 10)

const list = shootListItem.array()

const TONE: Record<ShootStatus, 'info' | 'success' | 'warning' | 'danger'> = {
  planned: 'warning',
  confirmed: 'info',
  completed: 'success',
  cancelled: 'danger',
}

/** A booking that still counts: cancelled and released seats are open again. */
const isLive = (s: TeamSlot) => s.status === 'booked'

const timeOf = (iso: string | null) =>
  iso ? new Date(iso).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }) : null

/**
 * This project's shoots, as the desk a studio actually plans from: every day,
 * what each day needs, who is on it, and what is still open.
 *
 * It used to be a read-only list that linked out — requirements were editable
 * only on the global /shoots page, crew only in Team Booking, and a saved
 * preset could only ever be applied while first creating the project. Planning
 * one wedding meant three screens.
 */
export function ShootsTab({ projectId }: { projectId: string }) {
  const { session } = useAuth()
  const access = useAccess()
  const canEdit = access.hasAction('projects', 'edit')
  const qc = useQueryClient()
  const shootTypes = useShootTypes()
  const presets = useShootPresets('shoot')
  const slots = useSlots()
  const dataRecords = useDataRecords()
  const [customOpen, setCustomOpen] = useState(false)
  const [pending, setPending] = useState<string | null>(null)

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['shoots', 'project', projectId],
    queryFn: () => callApi(`/shoots?project_id=${projectId}`, { responseSchema: list }),
    enabled: !!session && !!projectId,
    staleTime: 15_000,
  })

  const create = useMutation({
    mutationFn: (input: {
      name: string
      shoot_date?: string
      location?: string
      requirements?: ShootRequirementInput[]
    }) =>
      callApi('/shoots', {
        method: 'POST',
        body: createShootRequest.parse({
          project_id: projectId,
          name: input.name,
          ...(input.shoot_date ? { shoot_date: input.shoot_date } : {}),
          ...(input.location ? { location: input.location } : {}),
          ...(input.requirements?.length ? { requirements: input.requirements } : {}),
          status: 'planned',
        }),
        responseSchema: shootListItem.partial().passthrough(),
      }),
    onSuccess: (_d, v) => {
      toast.success(`${v.name} added`)
      void qc.invalidateQueries({ queryKey: ['shoots'] })
      void qc.invalidateQueries({ queryKey: ['projects'] })
    },
    onError: (e: Error) => toast.error(e.message),
    onSettled: () => setPending(null),
  })

  /**
   * The studio's own saved shoot types come first; the fixed list is the
   * fallback so a brand new studio still gets one-click chips.
   */
  const chips = (() => {
    const own = (shootTypes.data ?? []).filter((t) => !t.is_archived).map((t) => t.name)
    return own.length ? own.slice(0, 10) : [...QUICK_SHOOTS]
  })()

  return (
    <div className="mt-4 flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-muted-foreground">
          Plan every shoot day and assign crew per requirement
        </h2>
        <Button variant="outline" size="sm" asChild>
          <Link to="/shoots">
            <ExternalLink /> All shoots
          </Link>
        </Button>
      </div>

      {canEdit && (
        <div className="rounded-lg border border-border bg-muted/20 p-3">
          <p className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
            <Sparkles className="size-3.5" /> Quick add
          </p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {chips.map((name) => (
              <Button
                key={name}
                size="sm"
                variant="outline"
                disabled={create.isPending}
                onClick={() => {
                  setPending(name)
                  create.mutate({ name, shoot_date: todayISO() })
                }}
              >
                {pending === name ? 'Adding…' : name}
              </Button>
            ))}
            <Button size="sm" onClick={() => setCustomOpen(true)} disabled={create.isPending}>
              <Plus /> Full form
            </Button>
            {/* A preset used to be applicable only in the create-project wizard,
                so a studio could save the shape of its wedding day and then
                never reach it again. */}
            {(presets.data ?? []).length > 0 && (
              <Select
                value=""
                className="h-8 w-44"
                aria-label="Apply a saved preset"
                onChange={(e) => {
                  const p = (presets.data ?? []).find((x) => x.id === e.target.value)
                  if (!p) return
                  setPending(p.name)
                  create.mutate({
                    name: p.name,
                    shoot_date: todayISO(),
                    requirements: p.payload.requirements,
                  })
                }}
              >
                <option value="">Apply preset…</option>
                {(presets.data ?? []).map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </Select>
            )}
          </div>
          <p className="mt-1.5 text-[11px] text-muted-foreground">
            A chip creates the shoot dated today — set the real date, venue and crew on the card.
          </p>
        </div>
      )}

      {customOpen && (
        <CustomShootDialog
          busy={create.isPending}
          onClose={() => setCustomOpen(false)}
          onCreate={(v) => {
            create.mutate(v, { onSuccess: () => setCustomOpen(false) })
          }}
        />
      )}

      {isLoading ? (
        <SkeletonList rows={3} columns={3} />
      ) : isError ? (
        <ErrorState onRetry={() => void refetch()} />
      ) : !data || data.length === 0 ? (
        <EmptyState
          title="No shoots yet"
          description="Add a shoot to plan crew, requirements, and data for this project."
        />
      ) : (
        <div className="flex flex-col gap-3">
          {data.map((s) => (
            <ShootPlanner
              key={s.id}
              shoot={s}
              canEdit={canEdit}
              slots={(slots.data ?? []).filter((x) => x.shoot_id === s.id)}
              dataCount={(dataRecords.data ?? []).filter((d) => d.shoot_id === s.id)}
            />
          ))}
        </div>
      )}
    </div>
  )
}

/** One shoot day: what it needs, who is on it, and what is still open. */
function ShootPlanner({
  shoot,
  canEdit,
  slots,
  dataCount,
}: {
  shoot: ShootListItem
  canEdit: boolean
  slots: TeamSlot[]
  dataCount: { primary_status: string; backup_status: string }[]
}) {
  const update = useUpdateShoot()
  const del = useDeleteShoot()
  const services = useServices()
  const confirm = useConfirm()
  const [assignFor, setAssignFor] = useState<string | null>(null)
  const [editing, setEditing] = useState(false)

  const live = slots.filter(isLive)

  /** Per requirement: how many of that role are booked against how many needed. */
  const filled = useMemo(() => {
    const m = new Map<string, TeamSlot[]>()
    for (const s of live) {
      const key = (s.service_name ?? '').toLowerCase()
      m.set(key, [...(m.get(key) ?? []), s])
    }
    return m
  }, [live])

  const needed = shoot.requirements.reduce((n, r) => n + r.quantity, 0)
  const booked = shoot.requirements.reduce(
    (n, r) => n + Math.min((filled.get(r.name.toLowerCase()) ?? []).length, r.quantity),
    0,
  )
  const pct = needed === 0 ? 0 : Math.round((booked / needed) * 100)

  const dataReady = dataCount.filter(
    (d) => d.primary_status === 'verified' && d.backup_status === 'verified',
  ).length

  /** Roles this studio uses that are not yet on this day. */
  const roleChips = (() => {
    const own = (services.data ?? []).map((s) => s.name)
    const pool = own.length ? own : [...FALLBACK_ROLES]
    const have = new Set(shoot.requirements.map((r) => r.name.toLowerCase()))
    return pool.filter((n) => !have.has(n.toLowerCase())).slice(0, 8)
  })()

  function setRequirements(next: ShootRequirementInput[]) {
    update.mutate({ id: shoot.id, patch: { requirements: next } })
  }

  const asInput = (): ShootRequirementInput[] =>
    shoot.requirements.map((r) => ({ name: r.name, quantity: r.quantity }))

  const start = timeOf(shoot.start_at)
  const end = timeOf(shoot.end_at)

  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            <span className="flex items-center gap-2 font-medium">
              <Camera className="size-4 text-muted-foreground" />
              {shoot.name}
              <StatusBadge tone={TONE[shoot.status]}>{humanize(shoot.status)}</StatusBadge>
            </span>
            <div className="mt-1 flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
              {shoot.shoot_date && <span>{shoot.shoot_date}</span>}
              {start && (
                <span className="flex items-center gap-1">
                  <Clock className="size-3" />
                  {start}
                  {end ? `–${end}` : ''}
                </span>
              )}
              {shoot.location && (
                <span className="flex items-center gap-1">
                  <MapPin className="size-3" />
                  {shoot.location}
                </span>
              )}
              {shoot.map_link && (
                <a
                  href={shoot.map_link}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="flex items-center gap-1 text-primary hover:underline"
                >
                  Map <ExternalLink className="size-3" />
                </a>
              )}
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            <StatusBadge tone={needed > 0 && booked >= needed ? 'success' : 'warning'}>
              {booked}/{needed} assigned
            </StatusBadge>
            <StatusBadge tone={dataCount.length > 0 && dataReady === dataCount.length ? 'success' : 'neutral'}>
              <Database className="size-3" /> Data {dataReady}/{dataCount.length}
            </StatusBadge>
            {canEdit && (
              <>
                <Button size="sm" variant="ghost" onClick={() => setEditing(true)} aria-label={`Edit ${shoot.name}`}>
                  <Pencil />
                </Button>
                <Button size="sm" variant="ghost" asChild>
                  <Link to="/shoots/$id" params={{ id: shoot.id }}>
                    Open
                  </Link>
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  aria-label={`Delete ${shoot.name}`}
                  onClick={async () => {
                    const yes = await confirm({
                      title: `Delete ${shoot.name}?`,
                      description: 'Its crew bookings go with it. This cannot be undone.',
                      destructive: true,
                      confirmLabel: 'Delete',
                    })
                    if (yes) del.mutate(shoot.id)
                  }}
                >
                  <Trash2 />
                </Button>
              </>
            )}
          </div>
        </div>

        {needed > 0 && (
          <div className="mt-3">
            <div className="flex items-center justify-between text-[11px] text-muted-foreground">
              <span>Crew booked</span>
              <span className="tabular-nums">{pct}%</span>
            </div>
            <div
              className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-muted"
              role="progressbar"
              aria-valuenow={pct}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-label={`${shoot.name} crew booked`}
            >
              <div
                className={cn('h-full rounded-full transition-[width] duration-500', pct === 100 ? 'bg-success' : 'bg-primary')}
                style={{ width: `${pct}%` }}
              />
            </div>
          </div>
        )}

        {/* Adding a role used to mean opening the global shoots page and
            editing the requirement list there. */}
        {canEdit && roleChips.length > 0 && (
          <div className="mt-3 rounded-md border border-border bg-muted/20 p-2.5">
            <p className="flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground">
              <Users className="size-3.5" /> Add a role this day needs
            </p>
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {roleChips.map((name) => (
                <Button
                  key={name}
                  size="sm"
                  variant="outline"
                  disabled={update.isPending}
                  onClick={() => setRequirements([...asInput(), { name, quantity: 1 }])}
                >
                  <Plus /> {name}
                </Button>
              ))}
            </div>
          </div>
        )}

        <div className="mt-3 flex flex-col gap-2">
          {shoot.requirements.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              Nothing booked for this day yet — add the roles it needs above.
            </p>
          ) : (
            shoot.requirements.map((r) => {
              const on = filled.get(r.name.toLowerCase()) ?? []
              const full = on.length >= r.quantity
              return (
                <div
                  key={r.service_id}
                  className={cn(
                    'rounded-md border-l-2 border border-border p-2.5',
                    full ? 'border-l-success bg-success/5' : 'border-l-destructive bg-destructive/5',
                  )}
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium text-sm">{r.name}</span>
                    <span className="text-[11px] text-muted-foreground">Required {r.quantity}</span>
                    <StatusBadge tone={full ? 'success' : 'warning'}>
                      {on.length}/{r.quantity} assigned
                    </StatusBadge>
                    <span className="ml-auto flex items-center gap-1.5">
                      {canEdit && (
                        <>
                          <Button size="sm" variant={full ? 'outline' : 'default'} onClick={() => setAssignFor(r.name)}>
                            <UserPlus /> {full ? 'Manage' : 'Assign'}
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            aria-label={`Remove ${r.name}`}
                            onClick={() => setRequirements(asInput().filter((x) => x.name !== r.name))}
                          >
                            <Trash2 />
                          </Button>
                        </>
                      )}
                    </span>
                  </div>

                  {on.length === 0 ? (
                    <p className="mt-1.5 flex items-center gap-1.5 text-xs text-muted-foreground">
                      <AlertTriangle className="size-3.5 text-destructive" />
                      Nobody assigned yet.
                    </p>
                  ) : (
                    <ul className="mt-1.5 flex flex-col gap-1">
                      {on.map((sl) => (
                        <li key={sl.id} className="flex flex-wrap items-center gap-2 text-xs">
                          <span className="font-medium">{sl.user_name ?? 'Unknown'}</span>
                          <span className="text-muted-foreground">
                            {timeOf(sl.start_at)}–{timeOf(sl.end_at)}
                          </span>
                          {sl.final_cost != null || sl.estimated_cost != null ? (
                            <span className="text-muted-foreground">
                              {formatINR(sl.final_cost ?? sl.estimated_cost ?? 0)}
                            </span>
                          ) : (
                            <span className="text-muted-foreground">Cost not set</span>
                          )}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )
            })
          )}
        </div>

        {assignFor && (
          <AssignDialog
            shoot={shoot}
            role={assignFor}
            onClose={() => setAssignFor(null)}
          />
        )}
        {editing && <EditShootDialog shoot={shoot} onClose={() => setEditing(false)} />}
      </CardContent>
    </Card>
  )
}

/** Book one person onto one role on this day. */
function AssignDialog({ shoot, role, onClose }: { shoot: ShootListItem; role: string; onClose: () => void }) {
  const members = useMembers()
  const book = useBookSlot()
  const day = shoot.shoot_date ?? todayISO()
  const [userId, setUserId] = useState('')
  const [from, setFrom] = useState(`${day}T09:00`)
  const [to, setTo] = useState(`${day}T18:00`)
  const [cost, setCost] = useState('')

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent title={`Assign ${role}`} description={`${shoot.name}${shoot.shoot_date ? ` · ${shoot.shoot_date}` : ''}`}>
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="assign-who">Who</Label>
            <Select id="assign-who" value={userId} onChange={(e) => setUserId(e.target.value)}>
              <option value="">Pick someone</option>
              {(members.data ?? []).map((m) => (
                <option key={m.user_id} value={m.user_id}>
                  {m.name}
                </option>
              ))}
            </Select>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="assign-from">From</Label>
              <Input id="assign-from" type="datetime-local" value={from} onChange={(e) => setFrom(e.target.value)} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="assign-to">To</Label>
              <Input id="assign-to" type="datetime-local" value={to} onChange={(e) => setTo(e.target.value)} />
            </div>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="assign-cost">Estimated cost</Label>
            <Input
              id="assign-cost"
              inputMode="numeric"
              value={cost}
              onChange={(e) => setCost(e.target.value)}
              placeholder="Optional"
            />
          </div>
          <p className="text-xs text-muted-foreground">
            Double-booking is refused — if this person is already out on another shoot in these hours you will be
            told, rather than finding out on the day.
          </p>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button
              disabled={!userId || book.isPending}
              onClick={() =>
                book.mutate(
                  {
                    user_id: userId,
                    shoot_id: shoot.id,
                    service_name: role,
                    start_at: new Date(from).toISOString(),
                    end_at: new Date(to).toISOString(),
                    ...(cost.trim() ? { estimated_cost: Number(cost) } : {}),
                  },
                  { onSuccess: onClose },
                )
              }
            >
              {book.isPending ? 'Booking…' : 'Book'}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

/** Name, when, and where — editable without leaving the project. */
function EditShootDialog({ shoot, onClose }: { shoot: ShootListItem; onClose: () => void }) {
  const update = useUpdateShoot()
  const [name, setName] = useState(shoot.name)
  const [date, setDate] = useState(shoot.shoot_date ?? '')
  const [start, setStart] = useState(shoot.start_at ? shoot.start_at.slice(0, 16) : '')
  const [end, setEnd] = useState(shoot.end_at ? shoot.end_at.slice(0, 16) : '')
  const [location, setLocation] = useState(shoot.location ?? '')
  const [mapLink, setMapLink] = useState(shoot.map_link ?? '')
  const [status, setStatus] = useState<ShootStatus>(shoot.status)

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent title="Edit shoot" description="The day, the hours, and where the crew is going.">
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="edit-name">Name</Label>
            <Input id="edit-name" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="edit-date">Date</Label>
              <Input id="edit-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="edit-status">Status</Label>
              <Select id="edit-status" value={status} onChange={(e) => setStatus(e.target.value as ShootStatus)}>
                {(['planned', 'confirmed', 'completed', 'cancelled'] as ShootStatus[]).map((s) => (
                  <option key={s} value={s}>
                    {humanize(s)}
                  </option>
                ))}
              </Select>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="edit-start">Starts</Label>
              <Input id="edit-start" type="datetime-local" value={start} onChange={(e) => setStart(e.target.value)} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="edit-end">Ends</Label>
              <Input id="edit-end" type="datetime-local" value={end} onChange={(e) => setEnd(e.target.value)} />
            </div>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="edit-loc">Venue</Label>
            <Input id="edit-loc" value={location} onChange={(e) => setLocation(e.target.value)} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="edit-map">Map link</Label>
            <Input
              id="edit-map"
              value={mapLink}
              onChange={(e) => setMapLink(e.target.value)}
              placeholder="https://maps.app.goo.gl/…"
            />
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button
              disabled={!name.trim() || update.isPending}
              onClick={() =>
                update.mutate(
                  {
                    id: shoot.id,
                    patch: {
                      name: name.trim(),
                      status,
                      shoot_date: date || null,
                      start_at: start ? new Date(start).toISOString() : null,
                      end_at: end ? new Date(end).toISOString() : null,
                      location: location.trim() || null,
                      // '' clears it; the contract turns that into null.
                      map_link: mapLink.trim(),
                    },
                  },
                  { onSuccess: onClose },
                )
              }
            >
              {update.isPending ? 'Saving…' : 'Save'}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

/** The full form, for a shoot that is not one of the usual names. */
function CustomShootDialog({
  busy,
  onClose,
  onCreate,
}: {
  busy: boolean
  onClose: () => void
  onCreate: (v: { name: string; shoot_date?: string; location?: string }) => void
}) {
  const [name, setName] = useState('')
  const [date, setDate] = useState(todayISO())
  const [location, setLocation] = useState('')

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent title="Add a shoot" description="Anything the quick chips do not cover.">
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="shoot-name">
              Name <span className="text-destructive">*</span>
            </Label>
            <Input
              id="shoot-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Cocktail night"
            />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="shoot-date">Date</Label>
              <Input id="shoot-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="shoot-loc">Venue</Label>
              <Input
                id="shoot-loc"
                value={location}
                onChange={(e) => setLocation(e.target.value)}
                placeholder="Taj Lands End, Mumbai"
              />
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button
              disabled={!name.trim() || busy}
              onClick={() =>
                onCreate({
                  name: name.trim(),
                  ...(date ? { shoot_date: date } : {}),
                  ...(location.trim() ? { location: location.trim() } : {}),
                })
              }
            >
              {busy ? 'Adding…' : 'Add shoot'}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
