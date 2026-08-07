import { useMemo, useState } from 'react'
import { Link } from '@tanstack/react-router'
import { Plus } from 'lucide-react'
import type { ProjectStatus } from '@ipc/contracts'
import { AuthedPage } from '@/shared/layout/AuthedPage'
import { PageHeader } from '@/shared/layout/page-header'
import { FilterTabs } from '@/shared/layout/filter-tabs'
import { Button } from '@/shared/ui/button'
import { StatusBadge } from '@/shared/ui/status-badge'
import { LoadingState, ErrorState, EmptyState } from '@/shared/ui/states'
import { useIsMobile } from '@/shared/hooks/use-mobile'
import { formatINR, humanize } from '@/shared/ui/format'
import { useProjects } from '@/features/projects/api'

type Filter = ProjectStatus | 'all'

const STATUS_TONE: Record<ProjectStatus, 'info' | 'success' | 'danger' | 'warning'> = {
  active: 'info',
  completed: 'success',
  cancelled: 'danger',
  on_hold: 'warning',
}

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
  const isMobile = useIsMobile()

  const rows = useMemo(
    () => (data ?? []).filter((p) => filter === 'all' || p.status === filter),
    [data, filter],
  )

  return (
    <>
      <PageHeader
        title="Projects"
        description="Every shoot, deliverable and payment in one place."
        actions={
          <Button asChild>
            <Link to="/projects/new">
              <Plus /> New project
            </Link>
          </Button>
        }
      />

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
        className="mb-4"
      />

      {isLoading ? (
        <LoadingState />
      ) : isError ? (
        <ErrorState onRetry={() => void refetch()} />
      ) : rows.length === 0 ? (
        <EmptyState
          title="No projects yet"
          description="Create your first project to start tracking work and payments."
          action={
            <Button asChild>
              <Link to="/projects/new">
                <Plus /> New project
              </Link>
            </Button>
          }
        />
      ) : isMobile ? (
        <div className="flex flex-col gap-3">
          {rows.map((p) => (
            <Link
              key={p.id}
              to="/projects/$id"
              params={{ id: p.id }}
              className="rounded-lg border border-border p-4"
            >
              <div className="flex items-center justify-between">
                <span className="font-medium">{p.name}</span>
                <StatusBadge tone={STATUS_TONE[p.status]}>{humanize(p.status)}</StatusBadge>
              </div>
              <p className="mt-1 text-sm text-muted-foreground">{p.client_name ?? '—'}</p>
              <p className="mt-2 font-semibold">{formatINR(p.total_cost)}</p>
            </Link>
          ))}
        </div>
      ) : (
        <div className="overflow-hidden rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-left text-muted-foreground">
              <tr>
                <th className="px-4 py-2 font-medium">Project</th>
                <th className="px-4 py-2 font-medium">Client</th>
                <th className="px-4 py-2 font-medium">Status</th>
                <th className="px-4 py-2 text-right font-medium">Total</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((p) => (
                <tr key={p.id} className="border-t border-border hover:bg-muted/30">
                  <td className="px-4 py-2">
                    <Link to="/projects/$id" params={{ id: p.id }} className="font-medium hover:underline">
                      {p.name}
                    </Link>
                  </td>
                  <td className="px-4 py-2 text-muted-foreground">{p.client_name ?? '—'}</td>
                  <td className="px-4 py-2">
                    <StatusBadge tone={STATUS_TONE[p.status]}>{humanize(p.status)}</StatusBadge>
                  </td>
                  <td className="px-4 py-2 text-right font-medium">{formatINR(p.total_cost)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  )
}
