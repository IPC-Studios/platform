import { Link, useParams } from '@tanstack/react-router'
import { AuthedPage } from '@/shared/layout/AuthedPage'
import { PageHeader } from '@/shared/layout/page-header'
import { Breadcrumbs } from '@/shared/layout/breadcrumbs'
import { Card, CardContent, CardHeader, CardTitle } from '@/shared/ui/card'
import { StatCard } from '@/shared/ui/stat-card'
import { StatusBadge } from '@/shared/ui/status-badge'
import { LoadingState, ErrorState, EmptyState } from '@/shared/ui/states'
import { Button } from '@/shared/ui/button'
import { formatINR } from '@/shared/ui/format'
import { useProject } from '@/features/projects/api'

export function ProjectDetailPage() {
  return (
    <AuthedPage module="projects">
      <ProjectDetail />
    </AuthedPage>
  )
}

function ProjectDetail() {
  const { id } = useParams({ from: '/projects/$id' })
  const { data, isLoading, isError, refetch } = useProject(id)

  if (isLoading) return <LoadingState />
  if (isError || !data) return <ErrorState onRetry={() => void refetch()} />

  const received = data.payments.reduce((s, p) => s + p.amount, 0)
  const balance = Math.max(0, data.total_cost - received)

  return (
    <>
      <Breadcrumbs items={[{ label: 'Projects', to: '/projects' }, { label: data.name }]} />
      <PageHeader
        title={data.name}
        actions={<StatusBadge tone="info">{data.status}</StatusBadge>}
      />

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="Total" value={formatINR(data.total_cost)} />
        <StatCard label="Package" value={formatINR(data.package_cost)} />
        <StatCard label="Received" value={formatINR(received)} />
        <StatCard label="Balance" value={formatINR(balance)} />
      </div>

      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Deliverables</CardTitle>
          </CardHeader>
          <CardContent>
            {data.deliverables.length === 0 ? (
              <EmptyState title="No deliverables" />
            ) : (
              <ul className="divide-y divide-border">
                {data.deliverables.map((d) => (
                  <li key={d.id} className="flex items-center justify-between py-2">
                    <div>
                      <p className="font-medium">{d.title}</p>
                      <p className="text-xs text-muted-foreground">
                        {d.visibility_scope} · {d.list_key}
                      </p>
                    </div>
                    {d.is_additional_charge && (
                      <span className="text-sm font-medium">{formatINR(d.additional_charge_amount)}</span>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Payments</CardTitle>
          </CardHeader>
          <CardContent>
            {data.payments.length === 0 ? (
              <EmptyState title="No payments yet" />
            ) : (
              <ul className="divide-y divide-border">
                {data.payments.map((p) => (
                  <li key={p.id} className="flex items-center justify-between py-2 text-sm">
                    <span className="text-muted-foreground">
                      {p.paid_on} · {p.mode ?? '—'}
                    </span>
                    <span className="font-medium">{formatINR(p.amount)}</span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="mt-6">
        <Button asChild variant="outline">
          <Link to="/projects">Back to projects</Link>
        </Button>
      </div>
    </>
  )
}
