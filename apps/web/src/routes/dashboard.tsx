import { Link } from '@tanstack/react-router'
import { FolderKanban, Users, Receipt, Contact, Plus, ArrowRight } from 'lucide-react'
import { useAuth } from '@/shared/auth/AuthProvider'
import { useAccess } from '@/shared/auth/useAccess'
import { PageHeader } from '@/shared/layout/page-header'
import { StatCard } from '@/shared/ui/stat-card'
import { StatusBadge } from '@/shared/ui/status-badge'
import { Button } from '@/shared/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/shared/ui/card'
import { EmptyState } from '@/shared/ui/states'
import { formatINR, humanize } from '@/shared/ui/format'
import { useProjects } from '@/features/projects/api'
import { useClients } from '@/features/clients/api'
import { useMembers, useSlots } from '@/features/allocation/api'
import { useInvoices } from '@/features/billing/api'
import { useDataRecords } from '@/features/data/api'
import { useBoard } from '@/features/tasks/api'
import { buildJourney } from '@/features/onboarding/journey'
import { dashboardSections } from '@/features/onboarding/dashboard-sections'
import { SetupJourney } from '@/features/onboarding/SetupJourney'

export function DashboardPage() {
  return <DashboardInner />
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
  const slots = useSlots()
  const dataRecords = useDataRecords()
  const board = useBoard()

  const activeProjects = (projects.data ?? []).filter((p) => p.status === 'active').length
  const clientCount = clients.data?.length ?? 0
  const teamCount = members.data?.length ?? 0
  const outstanding = (invoices.data ?? []).reduce((s, i) => s + i.balance_due, 0)
  const recent = (projects.data ?? []).slice(0, 5)

  // The setup guide is for whoever is standing the studio up. An employee has
  // no business being told to add teammates or invoice a client.
  const isSetupAudience =
    session?.is_owner || session?.role === 'super_admin' || session?.role === 'admin'
  // Waiting on every query first — a half-loaded journey would show steps as
  // outstanding and then tick them off, which reads as work being undone.
  const journeyReady =
    !projects.isPending &&
    !clients.isPending &&
    !members.isPending &&
    !invoices.isPending &&
    !slots.isPending &&
    !dataRecords.isPending &&
    !board.isPending
  const journey = buildJourney(
    {
      // The owner is in the directory from registration, so they don't count.
      teammates: (members.data ?? []).filter((m) => m.user_id !== session?.user_id).length,
      clients: clientCount,
      projects: projects.data?.length ?? 0,
      bookings: (slots.data ?? []).filter((s) => s.status === 'booked').length,
      dataRecords: dataRecords.data?.length ?? 0,
      invoices: invoices.data?.length ?? 0,
      trackedTasks: board.data?.length ?? 0,
    },
    (m) => access.hasModule(m),
  )
  const showJourney = isSetupAudience && journeyReady && !journey.allDone
  const sections = dashboardSections(
    {
      activeProjects,
      clients: clientCount,
      teamMembers: teamCount,
      outstanding,
      recentProjects: recent.length,
    },
    showJourney,
  )

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

      {showJourney && (
        <SetupJourney steps={journey.steps} completed={journey.completed} total={journey.total} />
      )}

      {sections.stats && (
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
      )}

      {access.hasModule('projects') && sections.recentProjects && (
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
