import { useMemo, useState } from 'react'
import { useLocation, useNavigate } from '@tanstack/react-router'
import { ChevronDown } from 'lucide-react'
import type { CrmLead } from '@ipc/contracts'
import { AuthedPage } from '@/shared/layout/AuthedPage'
import { PageHeader } from '@/shared/layout/page-header'
import { Button } from '@/shared/ui/button'
import { SkeletonList } from '@/shared/ui/skeleton'
import { Card, CardContent } from '@/shared/ui/card'
import { cn } from '@/shared/ui/cn'
import { ErrorState } from '@/shared/ui/states'
import { CountUp } from '@/shared/ui/count-up'
import { useLeads } from '@/features/crm/api'
import { AddLeadDialog } from '@/features/crm/AddLeadDialog'
import { LeadDrawer } from '@/features/crm/LeadDrawer'
import { SetupChecklist } from '@/features/crm/SetupChecklist'
import { EMPTY_QUERY, STAGES, countsFor, summarise, type LeadQuery } from '@/features/crm/leads'
import { InboxTab } from '@/features/crm/tabs/InboxTab'
import { FollowUpBoardTab, PipelineTab, TodayTab } from '@/features/crm/tabs/BoardTabs'
import { DistributionTab } from '@/features/crm/tabs/DistributionTab'
import { TemplatesTab } from '@/features/crm/tabs/TemplatesTab'
import { ReportsTab } from '@/features/crm/tabs/ReportsTab'
import { TeamTab } from '@/features/crm/tabs/TeamTab'
import { ImportsTab } from '@/features/crm/tabs/ImportsTab'
import { DuplicatesTab } from '@/features/crm/tabs/DuplicatesTab'
import { CrmSettingsTab } from '@/features/crm/tabs/SettingsTab'
import { ActivitiesTab } from '@/features/crm/tabs/ActivitiesTab'

/** Every tab of the CRM. All twelve are built. */
const TABS = [
  { key: 'inbox', label: 'Lead Inbox' },
  { key: 'today', label: "Today's Work" },
  { key: 'board', label: 'Follow-up Board' },
  { key: 'pipeline', label: 'Pipeline View' },
  { key: 'activities', label: 'Activities' },
  { key: 'distribution', label: 'Distribution Rules' },
  { key: 'templates', label: 'Templates' },
  { key: 'reports', label: 'Reports' },
  { key: 'team', label: 'Team Dashboard' },
  { key: 'imports', label: 'Imports & Workflows' },
  { key: 'duplicates', label: 'Duplicate Management' },
  { key: 'settings', label: 'CRM Settings' },
] as const

type TabKey = (typeof TABS)[number]['key']
const isTab = (v: unknown): v is TabKey => TABS.some((t) => t.key === v)

export function FollowUpsPage() {
  return (
    <AuthedPage module="crm">
      <Crm />
    </AuthedPage>
  )
}

/** The tab lives in the URL (?tab=), so a reload and a shared link both land on it. */
function useTab(): [TabKey, (t: TabKey) => void] {
  const { search } = useLocation()
  const navigate = useNavigate()
  const current = (search as { tab?: unknown }).tab
  const tab: TabKey = isTab(current) ? current : 'inbox'
  const setTab = (t: TabKey) =>
    void navigate({ to: '/follow-ups', search: (t === 'inbox' ? {} : { tab: t }) as never, replace: true })
  return [tab, setTab]
}

function Crm() {
  const [tab, setTab] = useTab()
  const [query, setQuery] = useState<LeadQuery>(EMPTY_QUERY)
  const [openLead, setOpenLead] = useState<string | null>(null)
  const [showSummary, setShowSummary] = useState(false)
  const [showArchived, setShowArchived] = useState(false)

  const active = useLeads(false)
  // The full list, archived included, is only fetched when a tab needs it.
  const everything = useLeads(showArchived || tab === 'duplicates' || tab === 'settings')
  const leads = useMemo(() => active.data ?? [], [active.data])
  const allLeads = useMemo(() => everything.data ?? [], [everything.data])
  const archived = useMemo(() => allLeads.filter((l) => l.is_archived), [allLeads])

  // One clock for the whole page, so a lead cannot be "due today" in the strip
  // and "overdue" in the table because two components asked at different times.
  const now = useMemo(() => new Date(), [active.data])
  const totals = useMemo(() => summarise(leads, now), [leads, now])
  const chipCounts = useMemo(() => countsFor(leads, now), [leads, now])

  const inboxLeads = showArchived ? allLeads : leads
  const selected = [...allLeads, ...leads].find((l) => l.id === openLead) ?? null

  return (
    <>
      <PageHeader
        title="CRM"
        description="Manage new leads, follow-ups, reminders, and your lead pipeline in one place."
        actions={<AddLeadDialog onAdded={(id) => setOpenLead(id)} />}
      />

      <SummaryStrip totals={totals} leads={leads} expanded={showSummary} onToggle={() => setShowSummary((s) => !s)} />

      <SetupChecklist leads={leads} onAddLead={() => setTab('inbox')} />

      <div role="tablist" aria-label="CRM sections" className="no-print mt-6 flex gap-1 overflow-x-auto rounded-lg border border-border bg-card p-1.5">
        {TABS.map((t) => (
          <button
            key={t.key}
            id={`crm-tab-${t.key}`}
            type="button"
            role="tab"
            aria-selected={tab === t.key}
            aria-controls="crm-tabpanel"
            onClick={() => setTab(t.key)}
            className={cn(
              'whitespace-nowrap rounded-lg px-3 py-2 text-sm font-medium transition-colors',
              tab === t.key ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-accent hover:text-foreground',
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div id="crm-tabpanel" role="tabpanel" aria-labelledby={`crm-tab-${tab}`} className="mt-4">
        {active.isLoading ? (
          <SkeletonList rows={5} columns={5} />
        ) : active.isError ? (
          <ErrorState error={active.error} onRetry={() => void active.refetch()} />
        ) : tab === 'inbox' ? (
          <InboxTab
            leads={inboxLeads}
            now={now}
            query={query}
            onQuery={setQuery}
            counts={chipCounts}
            onOpen={setOpenLead}
            showArchived={showArchived}
            onShowArchived={setShowArchived}
          />
        ) : tab === 'today' ? (
          <TodayTab leads={leads} now={now} onOpen={setOpenLead} />
        ) : tab === 'board' ? (
          <FollowUpBoardTab leads={leads} now={now} onOpen={setOpenLead} />
        ) : tab === 'pipeline' ? (
          <PipelineTab leads={leads} onOpen={setOpenLead} />
        ) : tab === 'activities' ? (
          <ActivitiesTab leads={leads} onOpen={setOpenLead} />
        ) : tab === 'distribution' ? (
          <DistributionTab />
        ) : tab === 'templates' ? (
          <TemplatesTab />
        ) : tab === 'reports' ? (
          <ReportsTab leads={leads} />
        ) : tab === 'team' ? (
          <TeamTab />
        ) : tab === 'imports' ? (
          <ImportsTab />
        ) : tab === 'duplicates' ? (
          <DuplicatesTab archivedLeads={archived} />
        ) : (
          <CrmSettingsTab leads={leads} archived={archived} />
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
              <span className={cn('text-lg font-semibold tabular-nums', tone)}>
                <CountUp value={value} />
              </span>
              <span className="text-sm text-muted-foreground">{label}</span>
            </span>
          ))}
          <Button variant="ghost" size="sm" className="ml-auto" onClick={onToggle} aria-expanded={expanded}>
            <ChevronDown className={cn('transition-transform', expanded && 'rotate-180')} />
            {expanded ? 'Hide summary' : 'Show summary'}
          </Button>
        </div>

        {expanded && (
          <div className="mt-4 grid gap-2 border-t border-border pt-4 sm:grid-cols-3 lg:grid-cols-6">
            {STAGES.map((s) => (
              <div key={s.key} className="rounded-lg border border-border p-3">
                <p className="text-lg font-semibold tabular-nums">{leads.filter((l) => l.status === s.key).length}</p>
                <p className="text-xs text-muted-foreground">{s.label}</p>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
