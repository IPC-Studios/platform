import { useState } from 'react'
import type { CrmStatsQuery } from '@ipc/contracts'
import { SkeletonList } from '@/shared/ui/skeleton'
import { Card, CardContent } from '@/shared/ui/card'
import { StatusBadge } from '@/shared/ui/status-badge'
import { EmptyState, ErrorState } from '@/shared/ui/states'
import { RecordCard, RecordCards } from '@/shared/ui/record-card'
import { Avatar } from '@/shared/ui/avatar'
import { useIsMobile } from '@/shared/hooks/use-mobile'
import { useTeamStats } from '../api'
import { DateRange, daysBack } from './DateRange'

/** Who is carrying what, and how fast they pick up the phone. */
export function TeamTab() {
  const [range, setRange] = useState<CrmStatsQuery>(() => daysBack(29))
  const { data, isLoading, isError, error, refetch } = useTeamStats(range)
  const isMobile = useIsMobile()

  const rows = (data ?? []).filter((r) => r.open + r.created + r.won + r.lost > 0)

  return (
    <div className="flex flex-col gap-4">
      <DateRange value={range} onChange={setRange} />
      {isLoading ? (
        <SkeletonList rows={5} columns={7} />
      ) : isError ? (
        <ErrorState error={error} onRetry={() => void refetch()} />
      ) : rows.length === 0 ? (
        <Card>
          <CardContent className="py-4">
            <EmptyState title="Nobody has leads yet" description="Assign leads, or put people on the distribution rota, and their numbers appear here." />
          </CardContent>
        </Card>
      ) : isMobile ? (
        <RecordCards>
          {rows.map((r) => (
            <RecordCard
              key={r.user_id}
              title={r.user_name}
              badge={r.overdue > 0 ? <StatusBadge tone="danger">{r.overdue} overdue</StatusBadge> : undefined}
              fields={[
                { label: 'Open', value: r.open, strong: true },
                { label: 'Due today', value: r.due_today },
                { label: 'Won', value: r.won },
                { label: 'Lost', value: r.lost },
                { label: 'New in range', value: r.created },
                { label: `Within ${r.sla_hours}h`, value: r.created ? `${Math.round((r.within_sla / r.created) * 100)}%` : '—' },
                { label: 'First response', value: r.avg_first_response_hours === null ? '—' : `${r.avg_first_response_hours} h` },
              ]}
            />
          ))}
        </RecordCards>
      ) : (
        <div className="table-wrap rounded-lg border border-border">
          <table className="table-sticky w-full text-sm">
            <thead className="bg-muted/50 text-left text-muted-foreground">
              <tr>
                <th className="min-w-48 px-4 py-2 font-medium">Member</th>
                <th className="px-4 py-2 text-right font-medium">Open</th>
                <th className="px-4 py-2 text-right font-medium">Overdue</th>
                <th className="px-4 py-2 text-right font-medium">Due today</th>
                <th className="px-4 py-2 text-right font-medium">Uncontacted</th>
                <th className="px-4 py-2 text-right font-medium">Hot</th>
                <th className="px-4 py-2 text-right font-medium">New</th>
                <th className="px-4 py-2 text-right font-medium">Won</th>
                <th className="px-4 py-2 text-right font-medium">Lost</th>
                <th className="px-4 py-2 text-right font-medium">Within SLA</th>
                <th className="px-4 py-2 text-right font-medium">First response</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.user_id} className="border-t border-border hover:bg-muted/30">
                  <td className="px-4 py-2">
                    <span className="flex items-center gap-2 font-medium">
                      <Avatar name={r.user_name} size="sm" /> {r.user_name}
                    </span>
                  </td>
                  <td className="px-4 py-2 text-right tabular-nums">{r.open}</td>
                  <td className={`px-4 py-2 text-right tabular-nums ${r.overdue > 0 ? 'font-medium text-destructive' : ''}`}>{r.overdue}</td>
                  <td className="px-4 py-2 text-right tabular-nums">{r.due_today}</td>
                  <td className={`px-4 py-2 text-right tabular-nums ${r.uncontacted > 0 ? 'text-warning' : ''}`}>{r.uncontacted}</td>
                  <td className="px-4 py-2 text-right tabular-nums">{r.hot}</td>
                  <td className="px-4 py-2 text-right tabular-nums">{r.created}</td>
                  <td className="px-4 py-2 text-right tabular-nums text-success">{r.won}</td>
                  <td className="px-4 py-2 text-right tabular-nums">{r.lost}</td>
                  <td className={`px-4 py-2 text-right tabular-nums ${r.created && r.within_sla / r.created < 0.8 ? 'text-warning' : ''}`}>
                    {r.created ? `${Math.round((r.within_sla / r.created) * 100)}%` : '—'}
                  </td>
                  <td className="px-4 py-2 text-right tabular-nums text-muted-foreground">
                    {r.avg_first_response_hours === null ? '—' : `${r.avg_first_response_hours} h`}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="text-xs text-muted-foreground">
        Open, overdue, due today, uncontacted and hot are as of now. New, won, lost, within-SLA and first response are within the range. The SLA target is set on the CRM Settings tab.
      </p>
    </div>
  )
}
