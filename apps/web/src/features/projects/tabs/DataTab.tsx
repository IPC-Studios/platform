import { Link } from '@tanstack/react-router'
import { Database, Plus } from 'lucide-react'
import type { CustodyStatus } from '@ipc/contracts'
import { Button } from '@/shared/ui/button'
import { Card, CardContent } from '@/shared/ui/card'
import { StatusBadge } from '@/shared/ui/status-badge'
import { SkeletonList } from '@/shared/ui/skeleton'
import { ErrorState, EmptyState } from '@/shared/ui/states'
import { humanize } from '@/shared/ui/format'
import { useProjectDataRecords, useVerifyData } from '@/features/data/api'

const TONE: Record<CustodyStatus, 'neutral' | 'warning' | 'success'> = {
  pending: 'neutral',
  copied: 'warning',
  verified: 'success',
}

/** This project's own shoot data records — a real tab instead of a link away to the global page. */
export function DataTab({ projectId, canEdit }: { projectId: string; canEdit: boolean }) {
  const { data, isLoading, isError, refetch } = useProjectDataRecords(projectId)
  const verify = useVerifyData()

  return (
    <div className="mt-4 flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-muted-foreground">Data for this project</h2>
        <Button variant="outline" size="sm" asChild>
          <Link to="/data-management">
            <Plus /> Add record
          </Link>
        </Button>
      </div>

      {isLoading ? (
        <SkeletonList rows={3} columns={4} />
      ) : isError ? (
        <ErrorState onRetry={() => void refetch()} />
      ) : !data || data.length === 0 ? (
        <EmptyState
          title="No data recorded"
          description="Track each card or drive's primary and backup copy status here."
          action={
            <Button variant="outline" size="sm" asChild>
              <Link to="/data-management">
                <Plus /> Add record
              </Link>
            </Button>
          }
        />
      ) : (
        <ul className="flex flex-col gap-2">
          {data.map((d) => (
            <li key={d.id}>
              <Card>
                <CardContent className="flex flex-wrap items-center gap-3 p-4">
                  <Database className="size-4 shrink-0 text-muted-foreground" />
                  <span className="min-w-0 flex-1 font-medium">{d.data_label}</span>
                  <span className="text-xs text-muted-foreground">{d.data_type ?? '—'}</span>
                  <span className="text-xs text-muted-foreground">{d.size_gb} GB</span>
                  <div className="flex items-center gap-1.5">
                    <span className="text-xs text-muted-foreground">Primary</span>
                    {canEdit && d.primary_status !== 'verified' ? (
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={verify.isPending}
                        onClick={() => verify.mutate({ id: d.id, track: 'primary' })}
                      >
                        {humanize(d.primary_status)} — verify
                      </Button>
                    ) : (
                      <StatusBadge tone={TONE[d.primary_status]}>{humanize(d.primary_status)}</StatusBadge>
                    )}
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className="text-xs text-muted-foreground">Backup</span>
                    {canEdit && d.backup_status !== 'verified' ? (
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={verify.isPending}
                        onClick={() => verify.mutate({ id: d.id, track: 'backup' })}
                      >
                        {humanize(d.backup_status)} — verify
                      </Button>
                    ) : (
                      <StatusBadge tone={TONE[d.backup_status]}>{humanize(d.backup_status)}</StatusBadge>
                    )}
                  </div>
                </CardContent>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
