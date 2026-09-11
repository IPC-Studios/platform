import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Link } from '@tanstack/react-router'
import { toast } from 'sonner'
import {
  Briefcase,
  Check,
  ExternalLink,
  MoreHorizontal,
  FileText,
  CircleCheck,
  Clock,
  Download,
  IndianRupee,
  Lightbulb,
  PauseCircle,
  Plus,
  Search,
  X,
} from 'lucide-react'
import type { ProjectListItem, ProjectStatus } from '@ipc/contracts'
import { AuthedPage } from '@/shared/layout/AuthedPage'
import { PageHeader } from '@/shared/layout/page-header'
import { Breadcrumbs } from '@/shared/layout/breadcrumbs'
import { FilterTabs } from '@/shared/layout/filter-tabs'
import { Button } from '@/shared/ui/button'
import { Card, CardContent } from '@/shared/ui/card'
import { HowToUse } from '@/shared/ui/how-to-use'
import { Input } from '@/shared/ui/input'
import { SkeletonList } from '@/shared/ui/skeleton'
import { StatusBadge } from '@/shared/ui/status-badge'
import { ErrorState, EmptyState } from '@/shared/ui/states'
import { useIsMobile } from '@/shared/hooks/use-mobile'
import { formatINR, humanize } from '@/shared/ui/format'
import { downloadCsv, toCsv } from '@/shared/ui/csv'
import { useIssueQuotation, useProjects } from '@/features/projects/api'
import { cn } from '@/shared/ui/cn'

type Filter = ProjectStatus | 'all'

const STATUS_TONE: Record<ProjectStatus, 'info' | 'success' | 'danger' | 'warning'> = {
  active: 'info',
  completed: 'success',
  cancelled: 'danger',
  on_hold: 'warning',
}

/** A glance at the badge should say which way a project is going. */
const STATUS_ICON: Record<ProjectStatus, typeof Clock> = {
  active: Clock,
  completed: CircleCheck,
  cancelled: X,
  on_hold: PauseCircle,
}

const dayFormat = new Intl.DateTimeFormat('en-IN', {
  day: '2-digit',
  month: 'short',
  year: 'numeric',
})
const created = (iso: string) => dayFormat.format(new Date(iso))

export function ProjectsListPage() {
  return (
    <AuthedPage module="projects">
      <ProjectsList />
    </AuthedPage>
  )
}

function ProjectsList() {
  const { data, isLoading, isError, refetch } = useProjects()
  const [filter, setFilter] = useState<Filter>('all')
  const [search, setSearch] = useState('')
  const [guide, setGuide] = useState(false)
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set())
  const isMobile = useIsMobile()

  const rows = useMemo(() => {
    const term = search.trim().toLowerCase()
    return (data ?? []).filter((p) => {
      if (filter !== 'all' && p.status !== filter) return false
      if (!term) return true
      // Studios look a project up by whose wedding it is at least as often as
      // by what they called it, so the client's name and number search too.
      return (
        p.name.toLowerCase().includes(term) ||
        (p.client_name ?? '').toLowerCase().includes(term) ||
        (p.client_phone ?? '').includes(term)
      )
    })
  }, [data, filter, search])

  // The totals describe what is on screen, not the whole table: filter to
  // "on hold" and the pending figure is what is stuck, which is the question
  // that filter was clicked to ask.
  const totals = useMemo(
    () =>
      rows.reduce(
        (acc, p) => ({
          value: acc.value + p.total_cost,
          received: acc.received + p.received,
          pending: acc.pending + Math.max(0, p.total_cost - p.received),
        }),
        { value: 0, received: 0, pending: 0 },
      ),
    [rows],
  )

  /**
   * Tick some rows and the export narrows to those; tick none and it takes
   * whatever the filters have left on screen. Either way the button says how
   * many are going, so nobody has to guess before they press it.
   */
  const exporting = useMemo(
    () => (selected.size ? rows.filter((p) => selected.has(p.id)) : rows),
    [rows, selected],
  )

  const allTicked = rows.length > 0 && rows.every((p) => selected.has(p.id))
  const toggleAll = () =>
    setSelected(allTicked ? new Set() : new Set(rows.map((p) => p.id)))
  const toggleOne = (id: string) =>
    setSelected((s) => {
      const next = new Set(s)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  const exportCsv = () =>
    downloadCsv(
      'projects.csv',
      toCsv(
        ['Project', 'Client', 'Phone', 'Status', 'Total', 'Received', 'Pending', 'Created'],
        exporting.map((p) => [
          p.name,
          p.client_name ?? '',
          p.client_phone ?? '',
          humanize(p.status),
          p.total_cost,
          p.received,
          Math.max(0, p.total_cost - p.received),
          created(p.created_at),
        ]),
      ),
    )

  return (
    <>
      <div className="mb-3">
        <Button variant="outline" size="sm" onClick={() => setGuide((g) => !g)}>
          <Lightbulb /> {guide ? 'Hide guide' : 'Show guide'}
        </Button>
      </div>

      <Breadcrumbs items={[{ label: 'Home', to: '/dashboard' }, { label: 'Projects' }]} />

      <PageHeader
        title="All Projects"
        description="View and manage all booked projects, client details, shoot status, and delivery progress."
        actions={
          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={exportCsv} disabled={exporting.length === 0}>
              <Download /> Export ({exporting.length})
            </Button>
            <Button asChild>
              <Link to="/projects/new">
                <Plus /> New project
              </Link>
            </Button>
          </div>
        }
      />

      {guide && (
        <HowToUse
          title="Working the list"
          description="Everything booked lives here; the totals follow whatever you have filtered to."
          steps={[
            'Filter by status, or search by project, client or phone.',
            'Read the row: what it is worth, what has come in, what is pending.',
            'Open a project to change it, or export the list as it stands.',
          ]}
        />
      )}

      <Card className="mt-4">
        <CardContent className="flex flex-wrap items-center gap-x-8 gap-y-3 p-4">
          <Figure icon={Briefcase} label="Projects" value={String(rows.length)} />
          <Figure icon={IndianRupee} label="Page value" value={formatINR(totals.value)} />
          <Figure icon={CircleCheck} label="Received" value={formatINR(totals.received)} tone="success" />
          <Figure icon={Clock} label="Pending" value={formatINR(totals.pending)} tone="warning" />
        </CardContent>
      </Card>

      <Card className="mt-4">
        <CardContent className="flex flex-col gap-3 p-4">
          <div className="flex items-center gap-2">
            <div className="relative flex-1">
              <Search
                className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
                aria-hidden
              />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search projects or clients…"
                aria-label="Search projects"
                className="pl-9"
              />
            </div>
            {/* Always offered, even with nothing typed: it also drops the row
                selection, which is the thing people get stuck with. */}
            <Button
              variant="ghost"
              onClick={() => {
                setSearch('')
                setFilter('all')
                setSelected(new Set())
              }}
            >
              <X /> Clear
            </Button>
          </div>

          <FilterTabs<Filter>
            value={filter}
            onChange={setFilter}
            tabs={[
              { value: 'all', label: 'All', count: data?.length },
              { value: 'active', label: 'Active' },
              { value: 'on_hold', label: 'On hold' },
              { value: 'completed', label: 'Completed' },
              { value: 'cancelled', label: 'Cancelled' },
            ]}
          />
        </CardContent>
      </Card>

      <div className="mt-4">
        {isLoading ? (
          <SkeletonList rows={5} columns={6} />
        ) : isError ? (
          <ErrorState onRetry={() => void refetch()} />
        ) : rows.length === 0 ? (
          <EmptyState
            title={data?.length ? 'Nothing matches' : 'No projects yet'}
            description={
              data?.length
                ? 'Try a different status, or clear the search.'
                : 'Create your first project to start tracking work and payments.'
            }
            action={
              data?.length ? undefined : (
                <Button asChild>
                  <Link to="/projects/new">
                    <Plus /> New project
                  </Link>
                </Button>
              )
            }
          />
        ) : isMobile ? (
          <div className="flex flex-col gap-3">
            {rows.map((p) => (
              <Link
                key={p.id}
                to="/projects/$id"
                params={{ id: p.id }}
                className="lift rounded-lg border border-border p-4"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium">{p.name}</span>
                  <StatusBadge tone={STATUS_TONE[p.status]}>{humanize(p.status)}</StatusBadge>
                </div>
                <p className="mt-1 text-sm text-muted-foreground">
                  {p.client_name ?? '—'}
                  {p.client_phone ? ` · ${p.client_phone}` : ''}
                </p>
                <div className="mt-2 flex flex-wrap items-baseline gap-x-4 text-sm">
                  <span className="font-semibold">{formatINR(p.total_cost)}</span>
                  <span className="text-success">{formatINR(p.received)} in</span>
                  <span className="text-warning">
                    {formatINR(Math.max(0, p.total_cost - p.received))} due
                  </span>
                </div>
              </Link>
            ))}
          </div>
        ) : (
          <div className="table-wrap rounded-lg border border-border">
            <table className="table-sticky w-full text-sm">
              <thead className="bg-muted/50 text-left text-xs uppercase tracking-wider text-muted-foreground">
                <tr>
                  <th className="w-10 px-3 py-2.5">
                    <Tick
                      checked={allTicked}
                      onToggle={toggleAll}
                      label={allTicked ? 'Clear the selection' : 'Select every project listed'}
                    />
                  </th>
                  <th className="px-4 py-2.5 font-medium">Project</th>
                  <th className="px-4 py-2.5 font-medium">Client</th>
                  <th className="px-4 py-2.5 font-medium">Status</th>
                  <th className="px-4 py-2.5 text-right font-medium">Total</th>
                  <th className="px-4 py-2.5 text-right font-medium">Received</th>
                  <th className="px-4 py-2.5 text-right font-medium">Pending</th>
                  <th className="px-4 py-2.5 font-medium">Created</th>
                  <th className="w-12 px-3 py-2.5" />
                </tr>
              </thead>
              <tbody>
                {rows.map((p) => (
                  <Row
                    key={p.id}
                    project={p}
                    ticked={selected.has(p.id)}
                    onToggle={() => toggleOne(p.id)}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  )
}

function Row({
  project: p,
  ticked,
  onToggle,
}: {
  project: ProjectListItem
  ticked: boolean
  onToggle: () => void
}) {
  const pending = Math.max(0, p.total_cost - p.received)
  const StatusIcon = STATUS_ICON[p.status]
  return (
    <tr className={cn('border-t border-border hover:bg-muted/30', ticked && 'bg-primary/5')}>
      <td className="px-3 py-2.5">
        <Tick checked={ticked} onToggle={onToggle} label={`Select ${p.name}`} />
      </td>
      <td className="px-4 py-2.5">
        <Link to="/projects/$id" params={{ id: p.id }} className="font-medium hover:underline">
          {p.name}
        </Link>
      </td>
      <td className="px-4 py-2.5 text-muted-foreground">
        {p.client_name ?? '—'}
        {p.client_phone && <span className="text-xs"> · {p.client_phone}</span>}
      </td>
      <td className="px-4 py-2.5">
        <StatusBadge tone={STATUS_TONE[p.status]}>
          <StatusIcon className="mr-1 size-3" aria-hidden />
          {humanize(p.status)}
        </StatusBadge>
      </td>
      <td className="px-4 py-2.5 text-right font-medium tabular-nums">{formatINR(p.total_cost)}</td>
      {/* Zero received reads as neutral, not as good news. */}
      <td
        className={`px-4 py-2.5 text-right tabular-nums ${p.received > 0 ? 'text-success' : 'text-muted-foreground'}`}
      >
        {formatINR(p.received)}
      </td>
      <td
        className={`px-4 py-2.5 text-right tabular-nums ${pending > 0 ? 'text-warning' : 'text-muted-foreground'}`}
      >
        {formatINR(pending)}
      </td>
      <td className="px-4 py-2.5 text-muted-foreground">{created(p.created_at)}</td>
      <td className="px-3 py-2.5">
        <RowMenu project={p} />
      </td>
    </tr>
  )
}

/** One figure in the summary bar: icon, label above, number below. */
function Figure({
  icon: Icon,
  label,
  value,
  tone,
}: {
  icon: typeof Briefcase
  label: string
  value: string
  tone?: 'success' | 'warning'
}) {
  return (
    <div className="flex items-center gap-2.5">
      <span
        className={`flex size-8 shrink-0 items-center justify-center rounded-lg ${
          tone === 'success'
            ? 'bg-success/10 text-success'
            : tone === 'warning'
              ? 'bg-warning/10 text-warning'
              : 'bg-primary/10 text-primary'
        }`}
      >
        <Icon className="size-4" aria-hidden />
      </span>
      <div>
        <p className="text-[0.7rem] font-semibold uppercase tracking-wider text-muted-foreground">
          {label}
        </p>
        <p className="font-semibold tabular-nums">{value}</p>
      </div>
    </div>
  )
}
/**
 * The round tick from the reference, used for both the header and the rows.
 *
 * A button rather than a native checkbox: the native control cannot be shaped
 * like this, and the whole row is clickable anyway, so what matters is that it
 * announces itself as a checkbox and toggles on Space.
 */
function Tick({
  checked,
  onToggle,
  label,
}: {
  checked: boolean
  onToggle: () => void
  label: string
}) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      aria-label={label}
      onClick={(e) => {
        e.stopPropagation()
        onToggle()
      }}
      className={cn(
        'flex size-5 shrink-0 items-center justify-center rounded-full border transition-colors',
        checked
          ? 'border-primary bg-primary text-primary-foreground'
          : 'border-input hover:border-primary/50',
      )}
    >
      {checked && <Check className="size-3" aria-hidden />}
    </button>
  )
}

/**
 * The row's overflow menu.
 *
 * Only two things belong here: opening the project, and getting the quotation
 * link without opening it. Deleting a project from a list row is how a studio
 * loses a wedding by mis-tapping on a phone, so that stays on the project's
 * own page behind a confirmation.
 */
function RowMenu({ project }: { project: ProjectListItem }) {
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState({ top: 0, right: 0 })
  const btnRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const issue = useIssueQuotation()

  // Portaled to <body> with viewport coordinates: the row lives inside
  // .table-wrap, a bounded `overflow: auto` scroll box (so a sticky header
  // has something to stick to). Rendered as a plain descendant, the menu's
  // `top-full` popout got clipped by that box on every row whose "..." sat
  // near its bottom edge -- the click registered (state flipped) but nothing
  // ever appeared. Escaping to a portal sidesteps the clipping entirely.
  useEffect(() => {
    if (!open) return
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node
      if (btnRef.current?.contains(t) || menuRef.current?.contains(t)) return
      setOpen(false)
    }
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    // Any ancestor's scroll (the table-wrap included -- scroll doesn't
    // bubble, hence capture) invalidates the fixed position, so close rather
    // than let it drift away from the button.
    const onScrollOrResize = () => setOpen(false)
    document.addEventListener('pointerdown', onDown)
    document.addEventListener('keydown', onKey)
    window.addEventListener('scroll', onScrollOrResize, true)
    window.addEventListener('resize', onScrollOrResize)
    return () => {
      document.removeEventListener('pointerdown', onDown)
      document.removeEventListener('keydown', onKey)
      window.removeEventListener('scroll', onScrollOrResize, true)
      window.removeEventListener('resize', onScrollOrResize)
    }
  }, [open])

  function toggle() {
    if (!open && btnRef.current) {
      const r = btnRef.current.getBoundingClientRect()
      setPos({ top: r.bottom + 4, right: window.innerWidth - r.right })
    }
    setOpen((v) => !v)
  }

  return (
    <div className="relative flex justify-end">
      <button
        ref={btnRef}
        type="button"
        aria-label={`More for ${project.name}`}
        aria-expanded={open}
        onClick={(e) => {
          e.stopPropagation()
          toggle()
        }}
        className="flex size-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
      >
        <MoreHorizontal className="size-4" />
      </button>
      {open &&
        createPortal(
          <div
            ref={menuRef}
            role="menu"
            style={{ position: 'fixed', top: pos.top, right: pos.right }}
            className="ipc-menu z-40 w-52 overflow-hidden rounded-lg border border-border bg-card p-1.5 shadow-lg"
          >
            <Link
              to="/projects/$id"
              params={{ id: project.id }}
              role="menuitem"
              onClick={() => setOpen(false)}
              className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors hover:bg-muted"
            >
              <ExternalLink className="size-4 shrink-0" aria-hidden />
              Open project
            </Link>
            <button
              type="button"
              role="menuitem"
              disabled={issue.isPending}
              onClick={() =>
                issue.mutate(
                  { project_id: project.id, notes: null },
                  {
                    onSuccess: (r) => {
                      void navigator.clipboard?.writeText(r.link)
                      toast.success('Quotation link copied')
                      setOpen(false)
                    },
                  },
                )
              }
              className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors hover:bg-muted disabled:opacity-60"
            >
              <FileText className="size-4 shrink-0" aria-hidden />
              {issue.isPending ? 'Preparing…' : 'Copy quotation link'}
            </button>
          </div>,
          document.body,
        )}
    </div>
  )
}
