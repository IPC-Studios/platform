import { useState } from 'react'
import { Activity, Database, ScrollText, Timer, Settings, Plus, Trash2 } from 'lucide-react'
import type { AuditLogEntry, CronRun } from '@ipc/contracts'
import { useAuth } from '@/shared/auth/AuthProvider'
import { AuthedPage } from '@/shared/layout/AuthedPage'
import { PageHeader } from '@/shared/layout/page-header'
import { SettingsTabs } from '@/features/settings/SettingsTabs'
import { Button } from '@/shared/ui/button'
import { Input } from '@/shared/ui/input'
import { SkeletonList, SkeletonTiles } from '@/shared/ui/skeleton'
import { Card, CardContent } from '@/shared/ui/card'
import { HowToUse } from '@/shared/ui/how-to-use'
import { Select } from '@/shared/ui/input'
import { StatCard } from '@/shared/ui/stat-card'
import { StatusBadge } from '@/shared/ui/status-badge'
import { EmptyState, ErrorState } from '@/shared/ui/states'
import { RecordCard, RecordCards } from '@/shared/ui/record-card'
import { useIsMobile } from '@/shared/hooks/use-mobile'
import { humanize } from '@/shared/ui/format'
import { useAuditLog, useCronRuns, useHealth, useCustomLookups, useDeleteCustomLookup, useCreateCustomLookup } from '@/features/settings/api'

const when = new Intl.DateTimeFormat('en-IN', {
  day: 'numeric',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
})

const ENTITY_FILTERS = [
  ['', 'Everything'],
  ['company', 'Company'],
  ['user', 'Team members'],
  ['crm_lead', 'Leads'],
  ['invoice', 'Invoices'],
  ['project', 'Projects'],
  ['payment_order', 'Subscription'],
  ['employee_role', 'Roles'],
] as const

export function SystemPage() {
  return (
    <AuthedPage module="settings">
      <System />
    </AuthedPage>
  )
}

function System() {
  const { session } = useAuth()
  return (
    <>
      <PageHeader
        title="System"
        description="What changed, who changed it, and whether the machinery behind the studio is running."
      />
      <SettingsTabs />
      <HowToUse
        title="Find out what happened"
        description="Every change to the studio is written here with who made it and a reference you can quote to support."
        steps={['Filter the audit log by area.', 'Check the last scheduled runs.', 'Read the health card before reporting an outage.']}
      />
      <HealthCard />
      {session?.is_owner ? (
        <>
          <CustomLookups />
          <AuditLog />
          <CronRuns />
        </>
      ) : (
        <Card className="mt-4">
          <CardContent className="py-4">
            <EmptyState title="Owner only" description="The audit log and job history are visible to the studio owner." />
          </CardContent>
        </Card>
      )}
    </>
  )
}

function HealthCard() {
  const { data, isLoading, isError, refetch } = useHealth()
  if (isLoading) return <SkeletonTiles count={4} className="mt-4" />
  if (isError || !data) {
    return (
      <Card className="mt-4">
        <CardContent className="py-2">
          <ErrorState message="The API did not answer its health check." onRetry={() => void refetch()} />
        </CardContent>
      </Card>
    )
  }
  const uptime =
    data.uptime_s >= 86_400
      ? `${Math.floor(data.uptime_s / 86_400)}d ${Math.floor((data.uptime_s % 86_400) / 3600)}h`
      : data.uptime_s >= 3600
        ? `${Math.floor(data.uptime_s / 3600)}h ${Math.floor((data.uptime_s % 3600) / 60)}m`
        : `${Math.floor(data.uptime_s / 60)}m`
  return (
    <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
      <StatCard label="API" value={data.ok ? 'Up' : 'Degraded'} icon={Activity} />
      <StatCard
        label="Database"
        value={data.db === 'ok' ? 'Connected' : humanize(data.db)}
        icon={Database}
      />
      <StatCard label="DB latency" value={data.db_latency_ms === null ? '—' : `${data.db_latency_ms} ms`} icon={Timer} />
      <StatCard label="Uptime" value={`${uptime} · v${data.version}`} icon={ScrollText} />
    </div>
  )
}

function AuditLog() {
  const [entity, setEntity] = useState('')
  const q = useAuditLog(entity || undefined)
  const isMobile = useIsMobile()
  const items = q.data?.pages.flatMap((p) => p.items) ?? []

  return (
    <Card className="mt-6">
      <CardContent className="p-5 sm:p-6">
        <div className="flex flex-wrap items-center gap-3">
          <div className="min-w-0 flex-1">
            <h3 className="font-semibold tracking-tight">Audit log</h3>
            <p className="mt-0.5 text-sm text-muted-foreground">
              Every change, newest first. The reference is the id the API logged the request under.
            </p>
          </div>
          <Select value={entity} onChange={(e) => setEntity(e.target.value)} className="w-44" aria-label="Filter by area">
            {ENTITY_FILTERS.map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </Select>
        </div>

        <div className="mt-4">
          {q.isLoading ? (
            <SkeletonList rows={6} columns={5} />
          ) : q.isError ? (
            <ErrorState error={q.error} onRetry={() => void q.refetch()} />
          ) : items.length === 0 ? (
            <EmptyState title="Nothing recorded yet" description="Changes made from now on will be listed here." />
          ) : isMobile ? (
            <RecordCards>
              {items.map((e) => (
                <RecordCard
                  key={e.id}
                  title={humanize(e.action.replace('.', ' '))}
                  subtitle={`${e.actor_name ?? 'System'} · ${when.format(new Date(e.created_at))}`}
                  badge={<StatusBadge tone="neutral">{humanize(e.entity_type)}</StatusBadge>}
                  fields={[
                    { label: 'Reference', value: e.correlation_id ?? '—' },
                    { label: 'Change', value: summarise(e) },
                  ]}
                />
              ))}
            </RecordCards>
          ) : (
            <div className="table-wrap rounded-lg border border-border">
              <table className="table-sticky w-full text-sm">
                <thead className="bg-muted/50 text-left text-muted-foreground">
                  <tr>
                    <th className="px-4 py-2 font-medium">When</th>
                    <th className="px-4 py-2 font-medium">Who</th>
                    <th className="px-4 py-2 font-medium">Action</th>
                    <th className="px-4 py-2 font-medium">Change</th>
                    <th className="px-4 py-2 font-medium">Reference</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((e) => (
                    <tr key={e.id} className="border-t border-border align-top hover:bg-muted/30">
                      <td className="whitespace-nowrap px-4 py-2 text-muted-foreground">
                        {when.format(new Date(e.created_at))}
                      </td>
                      <td className="px-4 py-2">{e.actor_name ?? 'System'}</td>
                      <td className="px-4 py-2">
                        <span className="font-medium">{humanize(e.action.replace('.', ' '))}</span>
                        <span className="ml-2 text-xs text-muted-foreground">{humanize(e.entity_type)}</span>
                      </td>
                      <td className="max-w-md px-4 py-2 text-muted-foreground">{summarise(e)}</td>
                      <td className="px-4 py-2 font-mono text-xs text-muted-foreground">{e.correlation_id ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {q.hasNextPage && (
          <div className="mt-3 flex justify-center">
            <Button variant="outline" size="sm" onClick={() => void q.fetchNextPage()} disabled={q.isFetchingNextPage}>
              {q.isFetchingNextPage ? 'Loading…' : 'Show older'}
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

/** A one-line reading of the after (or before) payload. */
function summarise(e: AuditLogEntry): string {
  const payload = (e.after ?? e.before) as Record<string, unknown> | null
  if (!payload || typeof payload !== 'object') return e.entity_id ? `#${e.entity_id.slice(0, 8)}` : '—'
  const parts = Object.entries(payload)
    .filter(([, v]) => v !== undefined && v !== null && typeof v !== 'object')
    .slice(0, 4)
    .map(([k, v]) => `${humanize(k)}: ${String(v)}`)
  return parts.length ? parts.join(' · ') : e.entity_id ? `#${e.entity_id.slice(0, 8)}` : '—'
}

function CronRuns() {
  const { data, isLoading, isError, error, refetch } = useCronRuns()
  return (
    <Card className="mt-6">
      <CardContent className="p-5 sm:p-6">
        <h3 className="font-semibold tracking-tight">Scheduled jobs</h3>
        <p className="mt-0.5 text-sm text-muted-foreground">
          The hourly tick that turns reminders and overdue follow-ups into alerts. A run with no finish time did not complete.
        </p>
        <div className="mt-4">
          {isLoading ? (
            <SkeletonList rows={4} columns={4} />
          ) : isError ? (
            <ErrorState error={error} onRetry={() => void refetch()} />
          ) : !data || data.length === 0 ? (
            <EmptyState title="No runs yet" description="Runs appear here once the scheduler has called the API." />
          ) : (
            <ul className="divide-y divide-border">
              {data.map((r) => (
                <CronRow key={r.id} run={r} />
              ))}
            </ul>
          )}
        </div>
      </CardContent>
    </Card>
  )
}

function CronRow({ run }: { run: CronRun }) {
  const finished = !!run.finished_at
  const summary = Object.entries(run.summary)
    .filter(([k]) => k !== 'dry_run')
    .map(([k, v]) => `${humanize(k)} ${String(v)}`)
    .join(' · ')
  return (
    <li className="flex flex-wrap items-center gap-3 py-2.5 text-sm">
      <span className="w-40 shrink-0 text-muted-foreground">{when.format(new Date(run.started_at))}</span>
      <span className="font-medium">{humanize(run.job_name)}</span>
      <StatusBadge tone={finished ? 'success' : 'danger'}>{finished ? 'Completed' : 'Did not finish'}</StatusBadge>
      {run.dry_run && <StatusBadge tone="neutral">Dry run</StatusBadge>}
      <span className="min-w-0 flex-1 truncate text-muted-foreground">{summary || '—'}</span>
    </li>
  )
}

const LOOKUP_CATEGORIES = [
  { value: 'lead_source', label: 'Lead Sources' },
  { value: 'expense_category', label: 'Expense Categories' },
  { value: 'project_type', label: 'Project Types' },
  { value: 'currency', label: 'Currencies' },
]

function CustomLookups() {
  const [activeCategory, setActiveCategory] = useState('lead_source')
  const [newValue, setNewValue] = useState('')
  const { data: items, isLoading } = useCustomLookups(activeCategory)
  const create = useCreateCustomLookup()
  const del = useDeleteCustomLookup()

  function handleAdd() {
    if (!newValue.trim()) return
    create.mutate({ category: activeCategory, value: newValue.trim() }, {
      onSuccess: () => setNewValue(''),
    })
  }

  return (
    <Card className="mt-6">
      <CardContent className="p-5 sm:p-6">
        <div className="flex flex-wrap items-center gap-3">
          <div className="min-w-0 flex-1">
            <h3 className="font-semibold tracking-tight flex items-center gap-2">
              <Settings className="h-4 w-4" /> Custom Lookups
            </h3>
            <p className="mt-0.5 text-sm text-muted-foreground">
              Manage dropdown values used throughout the app: lead sources, expense categories, and more.
            </p>
          </div>
          <Select value={activeCategory} onChange={(e) => setActiveCategory(e.target.value)} className="w-48">
            {LOOKUP_CATEGORIES.map((c) => (
              <option key={c.value} value={c.value}>{c.label}</option>
            ))}
          </Select>
        </div>

        <div className="mt-4 flex gap-2">
          <Input
            value={newValue}
            onChange={(e) => setNewValue(e.target.value)}
            placeholder={`Add a new ${humanize(activeCategory).toLowerCase()}...`}
            onKeyDown={(e) => e.key === 'Enter' && handleAdd()}
          />
          <Button size="sm" onClick={handleAdd} disabled={!newValue.trim() || create.isPending}>
            <Plus className="h-4 w-4" />
          </Button>
        </div>

        <div className="mt-4">
          {isLoading ? (
            <SkeletonList rows={4} columns={3} />
          ) : !items || items.length === 0 ? (
            <EmptyState title="No values yet" description="Add your first lookup value above." />
          ) : (
            <ul className="divide-y divide-border">
              {items.map((item) => (
                <li key={item.id} className="flex items-center justify-between py-2 text-sm">
                  <div className="flex items-center gap-3">
                    <span className="font-medium">{item.value}</span>
                    <StatusBadge tone={item.is_active ? 'success' : 'neutral'}>
                      {item.is_active ? 'Active' : 'Inactive'}
                    </StatusBadge>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 text-destructive"
                    onClick={() => del.mutate(item.id)}
                    disabled={del.isPending}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </CardContent>
    </Card>
  )
}
