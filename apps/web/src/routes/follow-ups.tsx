import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { Link } from '@tanstack/react-router'
import {
  Bookmark,
  BookmarkPlus,
  ChevronDown,
  Construction,
  Flame,
  Search,
  Users,
  X,
} from 'lucide-react'
import type { CrmLead, LeadStatus } from '@ipc/contracts'
import { AuthedPage } from '@/shared/layout/AuthedPage'
import { PageHeader } from '@/shared/layout/page-header'
import { Button } from '@/shared/ui/button'
import { Card, CardContent } from '@/shared/ui/card'
import { cn } from '@/shared/ui/cn'
import { Input, Select } from '@/shared/ui/input'
import { StatusBadge } from '@/shared/ui/status-badge'
import { EmptyState, ErrorState, LoadingState } from '@/shared/ui/states'
import { useIsMobile } from '@/shared/hooks/use-mobile'
import { useDistribution, useLeads } from '@/features/crm/api'
import { AddLeadDialog } from '@/features/crm/AddLeadDialog'
import { LeadDrawer } from '@/features/crm/LeadDrawer'
import { SetupChecklist } from '@/features/crm/SetupChecklist'
import {
  DUE_COLUMNS,
  EMPTY_QUERY,
  QUICK_FILTERS,
  STAGES,
  STAGE_LABEL,
  applyQuery,
  boardColumns,
  countsFor,
  dueBucket,
  summarise,
  type LeadQuery,
  type QuickFilter,
} from '@/features/crm/leads'
import { deleteView, isSaveable, loadViews, saveView, type SavedView } from '@/features/crm/views'

/** Every tab from the CRM, and whether it is built yet. */
const TABS = [
  { key: 'inbox', label: 'Lead Inbox' },
  { key: 'today', label: "Today's Work" },
  { key: 'board', label: 'Follow-up Board' },
  { key: 'pipeline', label: 'Pipeline View' },
  { key: 'distribution', label: 'Distribution Rules' },
  { key: 'templates', label: 'Templates' },
  { key: 'reports', label: 'Reports' },
  { key: 'team', label: 'Team Dashboard' },
  { key: 'imports', label: 'Imports & Automations' },
  { key: 'duplicates', label: 'Duplicate Management' },
  { key: 'settings', label: 'CRM Settings' },
] as const

type TabKey = (typeof TABS)[number]['key']

const SOURCE_TONE: Record<string, 'info' | 'success' | 'warning' | 'neutral'> = {
  facebook: 'info',
  webform: 'neutral',
  referral: 'success',
  manual: 'neutral',
  enquiry: 'warning',
}

const STAGE_TONE: Record<LeadStatus, 'info' | 'success' | 'warning' | 'neutral' | 'danger'> = {
  new: 'info',
  contacted: 'neutral',
  qualified: 'warning',
  proposal_sent: 'warning',
  converted: 'success',
  lost: 'danger',
}

const dayFormat = new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short' })
const prettyDate = (iso: string) => dayFormat.format(new Date(iso))

export function FollowUpsPage() {
  return (
    <AuthedPage module="crm">
      <Crm />
    </AuthedPage>
  )
}

function Crm() {
  const [tab, setTab] = useState<TabKey>('inbox')
  const [query, setQuery] = useState<LeadQuery>(EMPTY_QUERY)
  const [openLead, setOpenLead] = useState<string | null>(null)
  const [showSummary, setShowSummary] = useState(false)

  const { data, isLoading, isError, refetch } = useLeads()
  const leads = useMemo(() => data ?? [], [data])

  // One clock for the whole page, so a lead cannot be "due today" in the strip
  // and "overdue" in the table because two components asked at different times.
  const now = useMemo(() => new Date(), [data])
  const totals = useMemo(() => summarise(leads, now), [leads, now])
  const chipCounts = useMemo(() => countsFor(leads, now), [leads, now])

  const selected = leads.find((l) => l.id === openLead) ?? null

  return (
    <>
      <PageHeader
        title="CRM"
        description="Manage new leads, follow-ups, reminders, and your lead pipeline in one place."
        actions={<AddLeadDialog onAdded={(id) => setOpenLead(id)} />}
      />

      <SummaryStrip
        totals={totals}
        leads={leads}
        expanded={showSummary}
        onToggle={() => setShowSummary((s) => !s)}
      />

      <SetupChecklist leads={leads} onAddLead={() => setTab('inbox')} />

      <div className="mt-6 flex gap-1 overflow-x-auto rounded-xl border border-border bg-card p-1.5">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setTab(t.key)}
            className={cn(
              'whitespace-nowrap rounded-lg px-3 py-2 text-sm font-medium transition-colors',
              tab === t.key
                ? 'bg-primary text-primary-foreground'
                : 'text-muted-foreground hover:bg-accent hover:text-foreground',
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="mt-4">
        {isLoading ? (
          <LoadingState />
        ) : isError ? (
          <ErrorState onRetry={() => void refetch()} />
        ) : tab === 'inbox' ? (
          <LeadInbox
            leads={leads}
            now={now}
            query={query}
            onQuery={setQuery}
            counts={chipCounts}
            onOpen={setOpenLead}
          />
        ) : tab === 'today' ? (
          <TodaysWork leads={leads} now={now} onOpen={setOpenLead} />
        ) : tab === 'board' ? (
          <FollowUpBoard leads={leads} now={now} onOpen={setOpenLead} />
        ) : tab === 'pipeline' ? (
          <PipelineView leads={leads} onOpen={setOpenLead} />
        ) : tab === 'distribution' ? (
          <DistributionRules />
        ) : (
          <ComingSoon label={TABS.find((t) => t.key === tab)?.label ?? 'This area'} />
        )}
      </div>

      {selected && <LeadDrawer lead={selected} onClose={() => setOpenLead(null)} />}
    </>
  )
}

function SummaryStrip({
  totals,
  leads,
  expanded,
  onToggle,
}: {
  totals: ReturnType<typeof summarise>
  leads: readonly CrmLead[]
  expanded: boolean
  onToggle: () => void
}) {
  const stats: Array<[string, number, string]> = [
    ['Total', totals.total, 'text-foreground'],
    ['Uncontacted', totals.uncontacted, 'text-warning'],
    ['Today', totals.today, 'text-primary'],
    ['Overdue', totals.overdue, 'text-destructive'],
    ['Hot', totals.hot, 'text-destructive'],
    ['Won (M)', totals.wonThisMonth, 'text-success'],
  ]

  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
          {stats.map(([label, value, tone]) => (
            <span key={label} className="flex items-baseline gap-1.5">
              <span className={cn('text-lg font-semibold tabular-nums', tone)}>{value}</span>
              <span className="text-sm text-muted-foreground">{label}</span>
            </span>
          ))}
          <Button variant="ghost" size="sm" className="ml-auto" onClick={onToggle}>
            <ChevronDown className={cn('transition-transform', expanded && 'rotate-180')} />
            {expanded ? 'Hide summary' : 'Show summary'}
          </Button>
        </div>

        {expanded && (
          <div className="mt-4 grid gap-2 border-t border-border pt-4 sm:grid-cols-3 lg:grid-cols-6">
            {STAGES.map((s) => (
              <div key={s.key} className="rounded-lg border border-border p-3">
                <p className="text-lg font-semibold tabular-nums">
                  {leads.filter((l) => l.status === s.key).length}
                </p>
                <p className="text-xs text-muted-foreground">{s.label}</p>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  )
}

function LeadInbox({
  leads,
  now,
  query,
  onQuery,
  counts,
  onOpen,
}: {
  leads: readonly CrmLead[]
  now: Date
  query: LeadQuery
  onQuery: (q: LeadQuery) => void
  counts: Record<QuickFilter, number>
  onOpen: (id: string) => void
}) {
  const [views, setViews] = useState<SavedView[]>([])
  const [naming, setNaming] = useState(false)
  const [viewName, setViewName] = useState('')
  const [dismissed, setDismissed] = useState(false)

  useEffect(() => setViews(loadViews()), [])

  const rows = useMemo(() => applyQuery(leads, query, now), [leads, query, now])
  const assignees = useMemo(() => {
    const seen = new Map<string, string>()
    for (const l of leads) if (l.assigned_to) seen.set(l.assigned_to, l.assignee_name ?? 'Unknown')
    return [...seen.entries()]
  }, [leads])

  const toggleFilter = (f: QuickFilter) =>
    onQuery({
      ...query,
      filters: query.filters.includes(f)
        ? query.filters.filter((x) => x !== f)
        : [...query.filters, f],
    })

  return (
    <div className="flex flex-col gap-4">
      {!dismissed && (
        <div className="flex items-start gap-3 rounded-xl border border-primary/20 bg-primary/[0.04] p-4 text-sm">
          <p className="flex-1 text-muted-foreground">
            <span className="font-medium text-foreground">Lead Inbox.</span> Stack quick filters to
            narrow the list, save the combinations you use daily, and click a row to open the lead.
          </p>
          <button
            type="button"
            onClick={() => setDismissed(true)}
            className="text-muted-foreground hover:text-foreground"
          >
            <X className="size-4" />
            <span className="sr-only">Dismiss</span>
          </button>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <Select
          className="w-48"
          value=""
          aria-label="Saved views"
          onChange={(e) => {
            const view = views.find((v) => v.name === e.target.value)
            if (view) onQuery(view.query)
          }}
        >
          <option value="">Saved views…</option>
          {views.map((v) => (
            <option key={v.name} value={v.name}>
              {v.name}
            </option>
          ))}
        </Select>

        {naming ? (
          <span className="flex items-center gap-2">
            <Input
              value={viewName}
              onChange={(e) => setViewName(e.target.value)}
              placeholder="Name this view"
              className="w-48"
              autoFocus
            />
            <Button
              size="sm"
              disabled={!viewName.trim()}
              onClick={() => {
                setViews(saveView(viewName, query))
                setViewName('')
                setNaming(false)
              }}
            >
              Save
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setNaming(false)}>
              Cancel
            </Button>
          </span>
        ) : (
          <Button
            variant="outline"
            size="sm"
            disabled={!isSaveable(query)}
            title={isSaveable(query) ? undefined : 'Filter the list first, then save it as a view.'}
            onClick={() => setNaming(true)}
          >
            <BookmarkPlus /> Save current view
          </Button>
        )}

        {views.length > 0 && (
          <span className="flex flex-wrap items-center gap-1">
            {views.map((v) => (
              <span
                key={v.name}
                className="flex items-center gap-1 rounded-full border border-border py-1 pl-2.5 pr-1 text-xs"
              >
                <Bookmark className="size-3" />
                <button type="button" onClick={() => onQuery(v.query)} className="hover:underline">
                  {v.name}
                </button>
                <button
                  type="button"
                  onClick={() => setViews(deleteView(v.name))}
                  className="rounded-full p-0.5 text-muted-foreground hover:text-destructive"
                >
                  <X className="size-3" />
                  <span className="sr-only">Delete {v.name}</span>
                </button>
              </span>
            ))}
          </span>
        )}
      </div>

      <div>
        <p className="mb-2 text-[0.7rem] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
          Quick filters
        </p>
        <div className="flex flex-wrap gap-2">
          {QUICK_FILTERS.map((f) => {
            const on = query.filters.includes(f.value)
            return (
              <button
                key={f.value}
                type="button"
                onClick={() => toggleFilter(f.value)}
                aria-pressed={on}
                className={cn(
                  'flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm transition-colors',
                  on
                    ? 'border-primary bg-primary/10 text-primary'
                    : 'border-border text-muted-foreground hover:border-primary/40 hover:text-foreground',
                )}
              >
                {f.label}
                <span className="text-xs tabular-nums opacity-70">{counts[f.value]}</span>
              </button>
            )
          })}
          {(query.filters.length > 0 || query.search || query.status !== 'all' || query.assignee !== 'all') && (
            <Button variant="ghost" size="sm" onClick={() => onQuery(EMPTY_QUERY)}>
              Clear
            </Button>
          )}
        </div>
      </div>

      <div className="grid gap-3 rounded-xl border border-border bg-card p-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="relative lg:col-span-2">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query.search}
            onChange={(e) => onQuery({ ...query, search: e.target.value })}
            placeholder="Search name, phone, email or notes…"
            className="pl-9"
            aria-label="Search leads"
          />
        </div>
        <Select
          value={query.status}
          onChange={(e) => onQuery({ ...query, status: e.target.value as LeadQuery['status'] })}
          aria-label="Stage"
        >
          <option value="all">All stages</option>
          {STAGES.map((s) => (
            <option key={s.key} value={s.key}>
              {s.label}
            </option>
          ))}
        </Select>
        <Select
          value={query.assignee}
          onChange={(e) => onQuery({ ...query, assignee: e.target.value })}
          aria-label="Owner"
        >
          <option value="all">Everyone</option>
          <option value="none">Unassigned</option>
          {assignees.map(([id, name]) => (
            <option key={id} value={id}>
              {name}
            </option>
          ))}
        </Select>
      </div>

      <LeadTable leads={rows} now={now} total={leads.length} onOpen={onOpen} />
    </div>
  )
}

function LeadTable({
  leads,
  now,
  total,
  onOpen,
}: {
  leads: readonly CrmLead[]
  now: Date
  total: number
  onOpen: (id: string) => void
}) {
  const isMobile = useIsMobile()

  if (leads.length === 0) {
    return (
      <Card>
        <CardContent className="py-4">
          <EmptyState
            title={total === 0 ? 'No leads yet.' : 'No leads match these filters.'}
            description={
              total === 0
                ? 'Add one by hand, or connect a web form so they arrive on their own.'
                : 'Clear a filter or two to widen the list.'
            }
          />
        </CardContent>
      </Card>
    )
  }

  if (isMobile) {
    return (
      <div className="flex flex-col gap-3">
        {leads.map((l) => (
          <button
            key={l.id}
            type="button"
            onClick={() => onOpen(l.id)}
            className="rounded-lg border border-border p-4 text-left"
          >
            <div className="flex items-start justify-between gap-2">
              <p className="truncate font-medium">{l.name ?? l.phone ?? 'Unnamed lead'}</p>
              <StatusBadge tone={STAGE_TONE[l.status]}>{STAGE_LABEL[l.status]}</StatusBadge>
            </div>
            <p className="mt-1 truncate text-sm text-muted-foreground">{l.phone ?? '—'}</p>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              {l.is_hot && (
                <StatusBadge tone="danger">
                  <Flame className="mr-1 size-3" /> Hot
                </StatusBadge>
              )}
              <DueBadge lead={l} now={now} />
            </div>
          </button>
        ))}
      </div>
    )
  }

  return (
    <div className="overflow-x-auto rounded-lg border border-border">
      <table className="w-full text-sm">
        <thead className="bg-muted/50 text-left text-muted-foreground">
          <tr>
            <th className="min-w-48 px-4 py-2 font-medium">Lead</th>
            <th className="px-4 py-2 font-medium">Stage</th>
            <th className="px-4 py-2 font-medium">Source</th>
            <th className="px-4 py-2 font-medium">Owner</th>
            <th className="px-4 py-2 font-medium">Follow-up</th>
          </tr>
        </thead>
        <tbody>
          {leads.map((l) => (
            <tr
              key={l.id}
              onClick={() => onOpen(l.id)}
              className="cursor-pointer border-t border-border hover:bg-muted/30"
            >
              <td className="px-4 py-2">
                <span className="flex items-center gap-2 font-medium">
                  {l.is_hot && <Flame className="size-3.5 shrink-0 text-destructive" />}
                  {l.name ?? 'Unnamed lead'}
                </span>
                <span className="text-xs text-muted-foreground">{l.phone ?? '—'}</span>
              </td>
              <td className="px-4 py-2">
                <StatusBadge tone={STAGE_TONE[l.status]}>{STAGE_LABEL[l.status]}</StatusBadge>
              </td>
              <td className="px-4 py-2">
                <StatusBadge tone={SOURCE_TONE[l.source] ?? 'neutral'}>{l.source}</StatusBadge>
              </td>
              <td className="px-4 py-2 text-muted-foreground">
                {l.assignee_name ?? <span className="text-warning">Unassigned</span>}
              </td>
              <td className="px-4 py-2">
                <DueBadge lead={l} now={now} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function DueBadge({ lead, now }: { lead: CrmLead; now: Date }) {
  const bucket = dueBucket(lead, now)
  if (bucket === 'none') {
    return <span className="text-xs text-muted-foreground">No follow-up</span>
  }
  const tone = bucket === 'overdue' ? 'danger' : bucket === 'today' ? 'warning' : 'neutral'
  const label =
    bucket === 'overdue'
      ? `Overdue · ${prettyDate(lead.follow_up_at!)}`
      : bucket === 'today'
        ? 'Due today'
        : prettyDate(lead.follow_up_at!)
  return <StatusBadge tone={tone}>{label}</StatusBadge>
}

/** Everything owed today or already late — the list to clear before going home. */
function TodaysWork({
  leads,
  now,
  onOpen,
}: {
  leads: readonly CrmLead[]
  now: Date
  onOpen: (id: string) => void
}) {
  const columns = boardColumns(leads, now)
  const due = [...columns.overdue, ...columns.today]

  return (
    <div className="flex flex-col gap-4">
      <div className="rounded-xl border border-border bg-muted/30 p-4 text-sm text-muted-foreground">
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
function FollowUpBoard({
  leads,
  now,
  onOpen,
}: {
  leads: readonly CrmLead[]
  now: Date
  onOpen: (id: string) => void
}) {
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

/** The classic stage board. */
function PipelineView({ leads, onOpen }: { leads: readonly CrmLead[]; onOpen: (id: string) => void }) {
  return (
    <div className="grid gap-3 md:grid-cols-3 xl:grid-cols-6">
      {STAGES.map((s) => {
        const inStage = leads.filter((l) => l.status === s.key)
        return (
          <BoardColumn key={s.key} title={s.label} count={inStage.length} tone={STAGE_TONE[s.key]}>
            {inStage.map((l) => (
              <LeadCard key={l.id} lead={l} onOpen={onOpen} />
            ))}
          </BoardColumn>
        )
      })}
    </div>
  )
}

function BoardColumn({
  title,
  hint,
  count,
  tone,
  children,
}: {
  title: string
  hint?: string
  count: number
  tone: 'danger' | 'warning' | 'neutral' | 'info' | 'success'
  children: ReactNode
}) {
  return (
    <div className="rounded-xl border border-border bg-card p-3">
      <div className="flex items-center justify-between gap-2">
        <p className="font-medium">{title}</p>
        <StatusBadge tone={tone}>{count}</StatusBadge>
      </div>
      {hint && <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p>}
      <div className="mt-3 flex flex-col gap-2">
        {count === 0 ? <p className="py-4 text-center text-xs text-muted-foreground">Empty</p> : children}
      </div>
    </div>
  )
}

function LeadCard({ lead, onOpen }: { lead: CrmLead; onOpen: (id: string) => void }) {
  return (
    <button
      type="button"
      onClick={() => onOpen(lead.id)}
      className="rounded-lg border border-border p-3 text-left transition-colors hover:bg-accent"
    >
      <p className="flex items-center gap-1.5 truncate text-sm font-medium">
        {lead.is_hot && <Flame className="size-3 shrink-0 text-destructive" />}
        {lead.name ?? 'Unnamed lead'}
      </p>
      <p className="truncate text-xs text-muted-foreground">{lead.phone ?? '—'}</p>
      <p className="mt-1 truncate text-xs text-muted-foreground">
        {lead.assignee_name ?? 'Unassigned'}
      </p>
    </button>
  )
}

/** Who new leads get handed to, and what each is carrying. */
function DistributionRules() {
  const { data, isLoading, isError, refetch } = useDistribution()

  if (isLoading) return <LoadingState />
  if (isError) return <ErrorState onRetry={() => void refetch()} />

  return (
    <Card>
      <CardContent className="p-5 sm:p-6">
        <h3 className="font-semibold tracking-tight">Lead distribution</h3>
        <p className="mt-0.5 text-sm text-muted-foreground">
          A new lead with no owner goes to whoever on this rota is carrying the fewest open leads.
          Ties break by priority.
        </p>

        {!data || data.length === 0 ? (
          <div className="mt-5">
            <EmptyState
              title="No rota set up"
              description="Until someone is on the rota, new leads arrive unassigned and wait for a person to pick them up."
            />
          </div>
        ) : (
          <ul className="mt-5 divide-y divide-border">
            {data.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center gap-3 py-3 first:pt-0 last:pb-0">
                <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                  <Users className="size-4" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">{r.user_name ?? 'Unknown member'}</p>
                  <p className="text-xs text-muted-foreground">Priority {r.priority}</p>
                </div>
                <StatusBadge tone={r.is_active ? 'success' : 'neutral'}>
                  {r.is_active ? 'Active' : 'Paused'}
                </StatusBadge>
                <StatusBadge>
                  {r.lead_count} open {r.lead_count === 1 ? 'lead' : 'leads'}
                </StatusBadge>
              </li>
            ))}
          </ul>
        )}

        <p className="mt-5 text-xs text-muted-foreground">
          Editing the rota is not built yet — rows come from the distribution rules the webhook
          capture already uses.
        </p>
      </CardContent>
    </Card>
  )
}

function ComingSoon({ label }: { label: string }) {
  return (
    <Card>
      <CardContent className="flex flex-col items-center gap-3 py-16 text-center">
        <Construction className="size-8 text-muted-foreground" />
        <p className="font-medium">{label} is on the roadmap</p>
        <p className="max-w-md text-sm text-muted-foreground">
          The lead inbox, follow-up board and pipeline are live. This area needs work that hasn’t
          been built yet — WhatsApp templates and automations need a messaging provider first.
        </p>
        <Button variant="outline" asChild>
          <Link to="/follow-ups">Back to the lead inbox</Link>
        </Button>
      </CardContent>
    </Card>
  )
}
