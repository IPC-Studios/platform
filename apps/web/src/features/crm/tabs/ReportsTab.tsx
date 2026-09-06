import { useState } from 'react'
import { Download, Printer } from 'lucide-react'
import type { CrmLead, CrmStatsQuery } from '@ipc/contracts'
import { Button } from '@/shared/ui/button'
import { SkeletonTiles } from '@/shared/ui/skeleton'
import { Card, CardContent } from '@/shared/ui/card'
import { StatCard } from '@/shared/ui/stat-card'
import { ErrorState } from '@/shared/ui/states'
import { useCrmStats } from '../api'
import { STAGE_LABEL } from '../leads'
import { DateRange, daysBack } from './DateRange'
import { exportLeadsCsv } from './shared'

const STAGE_ORDER = ['new', 'contacted', 'qualified', 'proposal_sent', 'converted', 'lost'] as const

export function ReportsTab({ leads }: { leads: readonly CrmLead[] }) {
  const [range, setRange] = useState<CrmStatsQuery>(() => daysBack(29))
  const { data, isLoading, isError, error, refetch } = useCrmStats(range)

  return (
    <div className="flex flex-col gap-4">
      <div className="no-print flex flex-wrap items-start gap-2">
        <div className="min-w-0 flex-1">
          <DateRange value={range} onChange={setRange} />
        </div>
        <Button variant="outline" size="sm" onClick={() => window.print()} title="Print this report">
          <Printer /> Print
        </Button>
      </div>

      {isLoading ? (
        <SkeletonTiles count={4} />
      ) : isError || !data ? (
        <ErrorState error={error} onRetry={() => void refetch()} />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <StatCard label="New leads" value={data.created} />
            <StatCard label="Won" value={data.won} />
            <StatCard label="Lost" value={data.lost} />
            <StatCard label="Conversion" value={`${Math.round(data.conversion_rate * 100)}%`} />
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            <Card>
              <CardContent className="p-5">
                <p className="font-medium">Pipeline by stage</p>
                <p className="mt-0.5 text-xs text-muted-foreground">Every open and closed lead right now.</p>
                <Bars rows={STAGE_ORDER.map((k) => [STAGE_LABEL[k], data.byStatus[k] ?? 0])} />
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-5">
                <p className="font-medium">Arrivals by source</p>
                <p className="mt-0.5 text-xs text-muted-foreground">Leads created in the range, by where they came from.</p>
                {Object.keys(data.bySource).length === 0 ? (
                  <p className="mt-4 text-sm text-muted-foreground">No leads arrived in this range.</p>
                ) : (
                  <Bars rows={Object.entries(data.bySource).sort((a, b) => b[1] - a[1])} />
                )}
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-5">
                <p className="font-medium">Right now</p>
                <dl className="mt-3 grid grid-cols-3 gap-3 text-sm">
                  <Stat label="Open + closed" value={data.total} />
                  <Stat label="Overdue" value={data.overdue} tone="text-destructive" />
                  <Stat label="Uncontacted" value={data.uncontacted} tone="text-warning" />
                </dl>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-5">
                <p className="font-medium">Export</p>
                <p className="mt-0.5 text-xs text-muted-foreground">A CSV of every lead in the inbox, for sheets.</p>
                <Button className="mt-3" variant="outline" size="sm" onClick={() => exportLeadsCsv(leads)}>
                  <Download /> Download CSV ({leads.length})
                </Button>
              </CardContent>
            </Card>
          </div>
        </>
      )}
    </div>
  )
}

function Stat({ label, value, tone }: { label: string; value: number; tone?: string }) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className={`text-xl font-semibold tabular-nums ${tone ?? ''}`}>{value}</dd>
    </div>
  )
}

function Bars({ rows }: { rows: ReadonlyArray<readonly [string, number]> }) {
  const max = Math.max(1, ...rows.map(([, v]) => v))
  return (
    <div className="mt-3 flex flex-col gap-2">
      {rows.map(([label, value]) => (
        <div key={label} className="flex items-center gap-3">
          <span className="w-28 truncate text-sm">{label}</span>
          <div className="h-2 flex-1 rounded-full bg-muted" role="img" aria-label={`${label}: ${value}`}>
            <div className="h-2 rounded-full bg-primary transition-[width]" style={{ width: `${Math.round((value / max) * 100)}%` }} />
          </div>
          <span className="w-8 text-right text-xs tabular-nums">{value}</span>
        </div>
      ))}
    </div>
  )
}
