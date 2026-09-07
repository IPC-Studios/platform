import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react'
import { Link } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { CalendarClock, ChevronLeft, ChevronRight, UserPlus } from 'lucide-react'
import { findConflicts, overlaps } from '@ipc/domain'
import { shootListItem, type BookSlotRequest, type ShootListItem, type TeamSlot } from '@ipc/contracts'
import { AuthedPage } from '@/shared/layout/AuthedPage'
import { PageHeader } from '@/shared/layout/page-header'
import { callApi } from '@/shared/api/client'
import { useAuth } from '@/shared/auth/AuthProvider'
import { useAccess } from '@/shared/auth/useAccess'
import { Button } from '@/shared/ui/button'
import { SkeletonCards } from '@/shared/ui/skeleton'
import { Card, CardContent } from '@/shared/ui/card'
import { Dialog, DialogClose, DialogContent, DialogTrigger } from '@/shared/ui/dialog'
import { Input, Label, Select } from '@/shared/ui/input'
import { StatusBadge } from '@/shared/ui/status-badge'
import { ErrorState, EmptyState } from '@/shared/ui/states'
import { formatINR } from '@/shared/ui/format'
import { cn } from '@/shared/ui/cn'
import { useSlots, useMembers, useBookSlot, ApiError } from '@/features/allocation/api'

export function TeamAllocationPage() {
  return (
    <AuthedPage module="projects">
      <TeamBooking />
    </AuthedPage>
  )
}

type Tab = 'calendar' | 'dashboard' | 'conflicts'
type CalendarView = 'month' | 'member'

const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
]

const dayHeading = new Intl.DateTimeFormat('en-IN', {
  weekday: 'long',
  day: 'numeric',
  month: 'long',
})
const shortDay = new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short' })
const timeOf = (iso: string) =>
  new Date(iso).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })
const same = (a: string | null, b: string | null) =>
  (a ?? '').trim().toLowerCase() === (b ?? '').trim().toLowerCase()

/**
 * Team Booking — a month of shoots, and who is on each one.
 *
 * Built around the shoot rather than the booking. A flat list of slots cannot
 * answer the question a manager actually has — "Saturday needs two
 * photographers, has it got them?" — so the requirements recorded on the shoot
 * are the frame, and bookings are filled against them.
 */
function TeamBooking() {
  const { session } = useAuth()
  const access = useAccess()
  const [tab, setTab] = useState<Tab>('calendar')
  const [view, setView] = useState<CalendarView>('month')
  const today = new Date()
  const [year, setYear] = useState(today.getFullYear())
  const [month, setMonth] = useState(today.getMonth())
  /** The shoot an "Assign" press came from, so the dialog opens already filled. */
  const [assignTo, setAssignTo] = useState<ShootListItem | null>(null)

  const slots = useSlots()
  const shoots = useQuery({
    queryKey: ['shoots'],
    queryFn: () => callApi('/shoots', { responseSchema: shootListItem.array() }),
    enabled: !!session && access.hasModule('projects'),
    staleTime: 30_000,
  })

  const booked = useMemo(() => (slots.data ?? []).filter((s) => s.status === 'booked'), [slots.data])

  const from = new Date(year, month, 1)
  const to = new Date(year, month + 1, 0)
  const inMonth = useMemo(() => {
    const mm = String(month + 1).padStart(2, '0')
    const start = `${year}-${mm}-01`
    const end = `${year}-${mm}-${String(to.getDate()).padStart(2, '0')}`
    return (shoots.data ?? [])
      .filter((s) => s.shoot_date && s.shoot_date >= start && s.shoot_date <= end)
      .filter((s) => s.status !== 'cancelled')
      .sort((a, b) => (a.shoot_date ?? '').localeCompare(b.shoot_date ?? ''))
  }, [shoots.data, year, month, to])

  /** Shoots under their day, which is how a month gets read. */
  const days = useMemo(() => {
    const map = new Map<string, ShootListItem[]>()
    for (const s of inMonth) {
      if (!s.shoot_date) continue
      map.set(s.shoot_date, [...(map.get(s.shoot_date) ?? []), s])
    }
    return [...map.entries()]
  }, [inMonth])

  const step = (by: number) => {
    const next = new Date(year, month + by, 1)
    setYear(next.getFullYear())
    setMonth(next.getMonth())
  }

  return (
    <>
      <PageHeader
        title="Team Booking"
        description="Book your team for upcoming shoots and avoid double-booking."
        actions={
          <BookDialog
            shoots={inMonth}
            trigger={
              <Button>
                <UserPlus /> Bulk Assign
              </Button>
            }
          />
        }
      />

      <div className="flex flex-wrap items-center gap-1 rounded-lg border border-border bg-card p-1.5">
        {(['calendar', 'dashboard', 'conflicts'] as const).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            aria-current={tab === t ? 'page' : undefined}
            className={cn(
              'rounded-full px-4 py-1.5 text-sm font-medium capitalize transition-colors',
              tab === t
                ? 'bg-primary text-primary-foreground'
                : 'text-muted-foreground hover:bg-accent hover:text-foreground',
            )}
          >
            {t}
          </button>
        ))}
      </div>

      {tab === 'calendar' && (
        <>
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <div className="flex items-center gap-1 rounded-full border border-border p-1">
              {(['month', 'member'] as const).map((v) => (
                <button
                  key={v}
                  type="button"
                  onClick={() => setView(v)}
                  className={cn(
                    'rounded-full px-3 py-1 text-sm font-medium capitalize transition-colors',
                    view === v
                      ? 'bg-primary text-primary-foreground'
                      : 'text-muted-foreground hover:text-foreground',
                  )}
                >
                  {v} view
                </button>
              ))}
            </div>

            <Stepper
              label={String(year)}
              onPrev={() => setYear((y) => y - 1)}
              onNext={() => setYear((y) => y + 1)}
            />
            <Stepper label={MONTHS[month] ?? ''} onPrev={() => step(-1)} onNext={() => step(1)} />
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setYear(today.getFullYear())
                setMonth(today.getMonth())
              }}
            >
              Today
            </Button>

            <span className="ml-auto text-sm text-muted-foreground">
              {shortDay.format(from)} – {shortDay.format(to)}, {year}
            </span>
          </div>

          <div className="mt-4">
            {shoots.isLoading || slots.isLoading ? (
              <SkeletonCards count={3} />
            ) : shoots.isError ? (
              <ErrorState error={shoots.error} onRetry={() => void shoots.refetch()} />
            ) : view === 'member' ? (
              <MemberView slots={booked} from={from} to={to} />
            ) : days.length === 0 ? (
              <EmptyState
                title="Nothing booked this month"
                description="Shoots scheduled in this month show up here, each with the crew it still needs."
              />
            ) : (
              <div className="flex flex-col gap-6">
                {days.map(([date, dayShoots]) => (
                  <div key={date}>
                    <div className="mb-2 flex items-center gap-2">
                      <p className="font-semibold">
                        {dayHeading.format(new Date(`${date}T00:00:00`))}
                      </p>
                      <StatusBadge>
                        {dayShoots.length} shoot{dayShoots.length === 1 ? '' : 's'}
                      </StatusBadge>
                    </div>
                    <div className="flex flex-col gap-3">
                      {dayShoots.map((s) => (
                        <ShootRow
                          key={s.id}
                          shoot={s}
                          slots={booked}
                          onAssign={() => setAssignTo(s)}
                        />
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}

      {tab === 'dashboard' && <BookingDashboard slots={booked} shoots={inMonth} />}
      {tab === 'conflicts' && <Conflicts slots={booked} />}

      {/* Every per-shoot Assign press opens this one, keyed so it starts fresh. */}
      {assignTo && (
        <BookDialog
          key={assignTo.id}
          shoots={inMonth}
          prefill={assignTo}
          openNow
          onClosed={() => setAssignTo(null)}
        />
      )}
    </>
  )
}

function Stepper({
  label,
  onPrev,
  onNext,
}: {
  label: string
  onPrev: () => void
  onNext: () => void
}) {
  return (
    <div className="flex items-center gap-1 rounded-full border border-border p-1">
      <button
        type="button"
        onClick={onPrev}
        aria-label={`Previous, from ${label}`}
        className="flex size-7 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
      >
        <ChevronLeft className="size-4" />
      </button>
      <span className="min-w-24 text-center text-sm font-medium">{label}</span>
      <button
        type="button"
        onClick={onNext}
        aria-label={`Next, from ${label}`}
        className="flex size-7 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
      >
        <ChevronRight className="size-4" />
      </button>
    </div>
  )
}

/**
 * One shoot on its day: what it needs, and who is in against it.
 *
 * Bookings match a requirement by service name — the same name the shoot card
 * wrote — so "Candid Photographer 1/2" reads as one short of the plan.
 */
function ShootRow({
  shoot,
  slots,
  onAssign,
}: {
  shoot: ShootListItem
  slots: readonly TeamSlot[]
  onAssign: () => void
}) {
  const mine = slots.filter((s) => s.shoot_id === shoot.id)
  const filledFor = (name: string) => mine.filter((s) => same(s.service_name, name)).length
  const needed = shoot.requirements.reduce((n, r) => n + r.quantity, 0)
  const filled = shoot.requirements.reduce((n, r) => n + Math.min(r.quantity, filledFor(r.name)), 0)
  const date = shoot.shoot_date ? new Date(`${shoot.shoot_date}T00:00:00`) : null

  return (
    <Card className="lift">
      <CardContent className="p-4">
        <div className="flex flex-wrap items-start gap-4">
          {date && (
            <div className="flex size-16 shrink-0 flex-col items-center justify-center rounded-lg border border-border">
              <span className="text-[0.65rem] font-semibold uppercase text-muted-foreground">
                {date.toLocaleString('en-IN', { month: 'short' })}
              </span>
              <span className="text-xl font-semibold leading-none">{date.getDate()}</span>
              <span className="text-[0.65rem] uppercase text-muted-foreground">
                {date.toLocaleString('en-IN', { weekday: 'short' })}
              </span>
            </div>
          )}

          <div className="min-w-0 flex-1">
            <p className="font-semibold">{shoot.name}</p>
            <p className="truncate text-sm text-muted-foreground">
              {shoot.project_name ?? '—'}
              {shoot.client_name ? ` · ${shoot.client_name}` : ''}
            </p>
            {shoot.location && (
              <p className="mt-0.5 truncate text-xs text-muted-foreground">{shoot.location}</p>
            )}
          </div>

          {shoot.requirements.length === 0 ? (
            <StatusBadge>No roles</StatusBadge>
          ) : (
            <StatusBadge tone={filled >= needed ? 'success' : 'warning'}>
              {filled} of {needed} booked
            </StatusBadge>
          )}
        </div>

        <div className="mt-3 rounded-lg border border-border p-3">
          {shoot.requirements.length === 0 ? (
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-sm text-muted-foreground">
                No requirements yet. Add roles in the shoot first.
              </p>
              <Button variant="outline" size="sm" asChild>
                <Link to="/projects/$id" params={{ id: shoot.project_id }}>
                  Open shoot
                </Link>
              </Button>
            </div>
          ) : (
            <div className="flex flex-wrap items-center gap-2">
              {shoot.requirements.map((r) => {
                const have = filledFor(r.name)
                const who = mine.filter((s) => same(s.service_name, r.name))
                return (
                  <span
                    key={r.service_id}
                    title={who.map((s) => s.user_name ?? 'Member').join(', ') || undefined}
                    className={cn(
                      'flex items-center gap-1.5 rounded-full border px-3 py-1 text-sm',
                      have >= r.quantity
                        ? 'border-success/40 bg-success/10 text-success'
                        : 'border-warning/40 bg-warning/10 text-warning',
                    )}
                  >
                    {r.name}
                    <span className="font-semibold tabular-nums">
                      {have}/{r.quantity}
                    </span>
                  </span>
                )
              })}
              <Button variant="outline" size="sm" className="ml-auto" onClick={onAssign}>
                <UserPlus /> Assign
              </Button>
            </div>
          )}
        </div>

        {mine.length > 0 && (
          <p className="mt-2 text-xs text-muted-foreground">
            Booked: {mine.map((s) => s.user_name ?? 'Member').join(', ')}
          </p>
        )}
      </CardContent>
    </Card>
  )
}

/** Who is booked, and how heavily, across the month on screen. */
function MemberView({ slots, from, to }: { slots: readonly TeamSlot[]; from: Date; to: Date }) {
  const end = new Date(to)
  end.setHours(23, 59, 59, 999)
  const byMember = new Map<string, TeamSlot[]>()
  for (const s of slots) {
    const at = new Date(s.start_at)
    if (at < from || at > end) continue
    const key = s.user_name ?? 'Unnamed'
    byMember.set(key, [...(byMember.get(key) ?? []), s])
  }

  if (byMember.size === 0) {
    return (
      <EmptyState
        title="Nobody booked this month"
        description="Assign crew to a shoot and their days show up here."
      />
    )
  }

  return (
    <div className="flex flex-col gap-3">
      {[...byMember.entries()].map(([name, theirs]) => (
        <Card key={name}>
          <CardContent className="p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="font-medium">{name}</p>
              <StatusBadge tone={theirs.length > 8 ? 'warning' : 'neutral'}>
                {theirs.length} day{theirs.length === 1 ? '' : 's'}
              </StatusBadge>
            </div>
            <div className="mt-2 flex flex-wrap gap-2">
              {theirs.map((s) => (
                <span
                  key={s.id}
                  className="rounded-full border border-border px-3 py-1 text-xs text-muted-foreground"
                >
                  {shortDay.format(new Date(s.start_at))} · {s.service_name ?? 'Crew'}
                </span>
              ))}
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  )
}

/** How the month is going: roles planned, roles filled, what it costs. */
function BookingDashboard({
  slots,
  shoots,
}: {
  slots: readonly TeamSlot[]
  shoots: readonly ShootListItem[]
}) {
  const needed = shoots.reduce((n, s) => n + s.requirements.reduce((m, r) => m + r.quantity, 0), 0)
  const filled = shoots.reduce(
    (n, s) =>
      n +
      s.requirements.reduce((m, r) => {
        const have = slots.filter((x) => x.shoot_id === s.id && same(x.service_name, r.name)).length
        return m + Math.min(r.quantity, have)
      }, 0),
    0,
  )
  const cost = slots.reduce((n, s) => n + (s.estimated_cost ?? 0), 0)
  const unstaffed = shoots.filter((s) => s.requirements.length === 0).length

  return (
    <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <Figure label="Shoots this month" value={String(shoots.length)} />
      <Figure label="Roles needed" value={String(needed)} />
      <Figure
        label="Roles filled"
        value={`${filled} of ${needed}`}
        tone={needed === 0 ? undefined : filled >= needed ? 'success' : 'warning'}
      />
      <Figure label="Booked cost" value={formatINR(cost)} />
      {unstaffed > 0 && (
        <Card className="sm:col-span-2 lg:col-span-4">
          <CardContent className="p-4 text-sm text-muted-foreground">
            {unstaffed} shoot{unstaffed === 1 ? ' has' : 's have'} no roles listed yet, so nothing
            can be booked against {unstaffed === 1 ? 'it' : 'them'}.
          </CardContent>
        </Card>
      )}
    </div>
  )
}

function Figure({
  label,
  value,
  tone,
}: {
  label: string
  value: string
  tone?: 'success' | 'warning' | undefined
}) {
  return (
    <Card>
      <CardContent className="p-4">
        <p className="text-sm text-muted-foreground">{label}</p>
        <p
          className={cn(
            'mt-0.5 text-xl font-semibold tabular-nums',
            tone === 'success' && 'text-success',
            tone === 'warning' && 'text-warning',
          )}
        >
          {value}
        </p>
      </CardContent>
    </Card>
  )
}

/**
 * Anyone booked in two places at once.
 *
 * The database refuses overlapping slots for one member, so this ought to stay
 * empty — it is here because "ought to" is not "does", and finding out on the
 * screen beats finding out on the day.
 */
function Conflicts({ slots }: { slots: readonly TeamSlot[] }) {
  const clashes: [TeamSlot, TeamSlot][] = []
  for (let i = 0; i < slots.length; i++) {
    for (let j = i + 1; j < slots.length; j++) {
      const a = slots[i]!
      const b = slots[j]!
      if (a.user_id === b.user_id && overlaps(a, b)) clashes.push([a, b])
    }
  }

  if (clashes.length === 0) {
    return (
      <div className="mt-4">
        <EmptyState title="No conflicts" description="Nobody is booked in two places at once." />
      </div>
    )
  }

  return (
    <div className="mt-4 flex flex-col gap-3">
      {clashes.map(([a, b]) => (
        <Card key={`${a.id}-${b.id}`} className="border-destructive/40">
          <CardContent className="p-4">
            <p className="font-medium text-destructive">
              {a.user_name ?? 'Someone'} is booked twice
            </p>
            <p className="mt-1 text-sm text-muted-foreground">
              {shortDay.format(new Date(a.start_at))} · {timeOf(a.start_at)}–{timeOf(a.end_at)}{' '}
              {a.service_name ?? 'Crew'} <span className="mx-1">vs</span>
              {timeOf(b.start_at)}–{timeOf(b.end_at)} {b.service_name ?? 'Crew'}
            </p>
          </CardContent>
        </Card>
      ))}
    </div>
  )
}

/**
 * Book one member onto one shoot.
 *
 * The role is typed against the shoot's own requirements, because a booking
 * only counts towards a gap when the two names agree — offering the shoot's
 * list makes that the easy path rather than a thing to remember.
 */
function BookDialog({
  shoots,
  prefill,
  openNow,
  onClosed,
  trigger,
}: {
  shoots: readonly ShootListItem[]
  prefill?: ShootListItem | null
  openNow?: boolean
  onClosed?: () => void
  trigger?: ReactNode
}) {
  const members = useMembers()
  const slots = useSlots()
  const book = useBookSlot()
  const [open, setOpen] = useState(!!openNow)
  const [userId, setUserId] = useState('')
  const [shootId, setShootId] = useState(prefill?.id ?? '')
  const [service, setService] = useState('')
  const [start, setStart] = useState('')
  const [end, setEnd] = useState('')
  const [cost, setCost] = useState(0)
  const [error, setError] = useState<string | null>(null)

  const shoot = shoots.find((s) => s.id === shootId) ?? null
  const shootDate = shoot?.shoot_date ?? null

  // A known shoot day is a starting point for the window — a shoot day runs
  // long here, and the two fields stay editable.
  useEffect(() => {
    if (!open || !shootDate) return
    setStart((v) => v || `${shootDate}T10:00`)
    setEnd((v) => v || `${shootDate}T22:00`)
  }, [open, shootDate])

  // Assign is pressed to fill a gap, so open on the first role still short of
  // what the shoot asked for.
  const gap = useMemo(() => {
    if (!shoot) return null
    const booked = (slots.data ?? []).filter(
      (s) => s.shoot_id === shoot.id && s.status === 'booked',
    )
    const short = shoot.requirements.find(
      (r) => booked.filter((s) => same(s.service_name, r.name)).length < r.quantity,
    )
    return short?.name ?? null
  }, [shoot, slots.data])

  useEffect(() => {
    if (open && gap) setService((v) => v || gap)
  }, [open, gap])

  const conflicts = useMemo(() => {
    if (!userId || !start || !end) return []
    const mine = (slots.data ?? []).filter((s) => s.user_id === userId && s.status === 'booked')
    try {
      return findConflicts(
        { start_at: new Date(start).toISOString(), end_at: new Date(end).toISOString() },
        mine,
      )
    } catch {
      return []
    }
  }, [userId, start, end, slots.data])

  function change(next: boolean) {
    setOpen(next)
    if (!next) onClosed?.()
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    try {
      const body: BookSlotRequest = {
        user_id: userId,
        shoot_id: shootId || null,
        service_name: service || undefined,
        start_at: new Date(start).toISOString(),
        end_at: new Date(end).toISOString(),
        estimated_cost: cost || undefined,
      }
      await book.mutateAsync(body)
      change(false)
      setUserId('')
      setService('')
      setStart('')
      setEnd('')
      setCost(0)
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.message
          : err instanceof Error
            ? err.message
            : 'Could not book.',
      )
    }
  }

  return (
    <Dialog open={open} onOpenChange={change}>
      {trigger && <DialogTrigger asChild>{trigger}</DialogTrigger>}
      <DialogContent
        title="Assign crew"
        description="Pick who, which shoot and when. A clash with an existing booking is refused."
      >
        <form onSubmit={onSubmit} className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <Label>Member</Label>
            <Select value={userId} onChange={(e) => setUserId(e.target.value)} required>
              <option value="">— Select —</option>
              {(members.data ?? []).map((m) => (
                <option key={m.user_id} value={m.user_id}>
                  {m.name}
                </option>
              ))}
            </Select>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label>Shoot</Label>
            <Select
              value={shootId}
              onChange={(e) => {
                setShootId(e.target.value)
                setService('')
              }}
            >
              <option value="">No particular shoot</option>
              {shoots.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.shoot_date ? `${s.shoot_date} · ` : ''}
                  {s.name}
                </option>
              ))}
            </Select>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label>Role</Label>
            <Input
              value={service}
              onChange={(e) => setService(e.target.value)}
              list="booking-roles"
              placeholder={shoot?.requirements[0]?.name ?? 'Candid Photographer'}
            />
            <datalist id="booking-roles">
              {(shoot?.requirements ?? []).map((r) => (
                <option key={r.service_id} value={r.name} />
              ))}
            </datalist>
            {shoot && shoot.requirements.length > 0 && (
              <p className="text-xs text-muted-foreground">
                Match one of the shoot&rsquo;s roles and the booking counts against it.
              </p>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <Label>Start</Label>
              <Input
                type="datetime-local"
                value={start}
                onChange={(e) => setStart(e.target.value)}
                required
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>End</Label>
              <Input
                type="datetime-local"
                value={end}
                onChange={(e) => setEnd(e.target.value)}
                required
              />
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label>Estimated cost (₹)</Label>
            <Input
              type="number"
              min={0}
              value={cost}
              onChange={(e) => setCost(Number(e.target.value))}
            />
          </div>

          {conflicts.length > 0 && (
            <p className="rounded-md bg-warning/10 px-3 py-2 text-sm text-warning">
              This member already has {conflicts.length} booking
              {conflicts.length === 1 ? '' : 's'} that overlap this window.
            </p>
          )}
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}

          <div className="mt-2 flex justify-end gap-2">
            <DialogClose asChild>
              <Button type="button" variant="outline">
                Cancel
              </Button>
            </DialogClose>
            <Button type="submit" disabled={book.isPending || conflicts.length > 0}>
              <CalendarClock /> {book.isPending ? 'Booking…' : 'Book'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
