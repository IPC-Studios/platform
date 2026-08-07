import { Link } from '@tanstack/react-router'
import { FolderKanban, Users, Receipt, Contact, Plus, ArrowRight } from 'lucide-react'
import { useAuth } from '@/shared/auth/AuthProvider'
import { useAccess } from '@/shared/auth/useAccess'
import { RequireAuth } from '@/shared/auth/guards'
import { AppShell } from '@/shared/layout/AppShell'
import { PageHeader } from '@/shared/layout/page-header'
import { StatCard } from '@/shared/ui/stat-card'
import { StatusBadge } from '@/shared/ui/status-badge'
import { Button } from '@/shared/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/shared/ui/card'
import { EmptyState } from '@/shared/ui/states'
import { formatINR, humanize } from '@/shared/ui/format'
import { useProjects } from '@/features/projects/api'
import { useClients } from '@/features/clients/api'
import { useMembers } from '@/features/allocation/api'
import { useInvoices } from '@/features/billing/api'

export function DashboardPage() {
  return (
    <RequireAuth>
      <AppShell>
        <DashboardInner />
      </AppShell>
    </RequireAuth>
  )
}

const STATUS_TONE = {
  active: 'info',
  completed: 'success',
  cancelled: 'danger',
  on_hold: 'warning',
} as const

function DashboardInner() {
  const { session } = useAuth()
  const access = useAccess()

  const projects = useProjects()
  const clients = useClients()
  const members = useMembers()
  const invoices = useInvoices()

  const activeProjects = (projects.data ?? []).filter((p) => p.status === 'active').length
  const clientCount = clients.data?.length ?? 0
  const teamCount = members.data?.length ?? 0
  const outstanding = (invoices.data ?? []).reduce((s, i) => s + i.balance_due, 0)
  const recent = (projects.data ?? []).slice(0, 5)

  return (
    <>
      <PageHeader
        title={`Welcome, ${session?.display_name ?? ''}`}
        description="Your studio at a glance."
        actions={
          access.hasAction('projects', 'create') && (
            <Button asChild>
              <Link to="/projects/new">
                <Plus /> New project
              </Link>
            </Button>
          )
        }
      />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {access.hasModule('projects') && (
          <StatCard label="Active projects" value={activeProjects} icon={FolderKanban} />
        )}
        {access.hasModule('clients') && (
          <StatCard label="Clients" value={clientCount} icon={Contact} />
        )}
        <StatCard label="Team members" value={teamCount} icon={Users} />
        {access.hasModule('billing') && (
          <StatCard label="Outstanding" value={formatINR(outstanding)} icon={Receipt} />
        )}
      </div>

      {access.hasModule('projects') && (
        <Card className="mt-6">
          <CardHeader className="flex-row items-center justify-between">
            <CardTitle>Recent projects</CardTitle>
            <Button asChild variant="ghost" size="sm">
              <Link to="/projects">
                View all <ArrowRight />
              </Link>
            </Button>
          </CardHeader>
          <CardContent>
            {recent.length === 0 ? (
              <EmptyState
                title="No projects yet"
                description="Create your first project to start tracking shoots, tasks and payments."
                action={
                  access.hasAction('projects', 'create') && (
                    <Button asChild>
                      <Link to="/projects/new">
                        <Plus /> New project
                      </Link>
                    </Button>
                  )
                }
              />
            ) : (
              <ul className="divide-y divide-border">
                {recent.map((p) => (
                  <li key={p.id}>
                    <Link
                      to="/projects/$id"
                      params={{ id: p.id }}
                      className="flex items-center justify-between py-2.5 hover:opacity-80"
                    >
                      <div>
                        <p className="font-medium">{p.name}</p>
                        <p className="text-xs text-muted-foreground">{p.client_name ?? '—'}</p>
                      </div>
                      <div className="flex items-center gap-3">
                        <span className="text-sm font-medium">{formatINR(p.total_cost)}</span>
                        <StatusBadge tone={STATUS_TONE[p.status]}>{humanize(p.status)}</StatusBadge>
                      </div>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      )}
    </>
  )
}
