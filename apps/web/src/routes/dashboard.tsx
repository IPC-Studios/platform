import { FolderKanban, Users, Receipt, Camera } from 'lucide-react'
import { useAuth } from '@/shared/auth/AuthProvider'
import { RequireAuth } from '@/shared/auth/guards'
import { AppShell } from '@/shared/layout/AppShell'
import { PageHeader } from '@/shared/layout/page-header'
import { StatCard } from '@/shared/ui/stat-card'
import { EmptyState } from '@/shared/ui/states'

export function DashboardPage() {
  return (
    <RequireAuth>
      <AppShell>
        <DashboardInner />
      </AppShell>
    </RequireAuth>
  )
}

function DashboardInner() {
  const { session } = useAuth()
  return (
    <>
      <PageHeader
        title={`Welcome, ${session?.display_name ?? ''}`}
        description="Your studio at a glance."
      />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Active projects" value="0" icon={FolderKanban} />
        <StatCard label="Upcoming shoots" value="0" icon={Camera} />
        <StatCard label="Team members" value="1" icon={Users} />
        <StatCard label="Outstanding" value="₹0" icon={Receipt} />
      </div>
      <div className="mt-6 rounded-lg border border-border">
        <EmptyState
          title="Nothing here yet"
          description="Create your first project to start tracking shoots, tasks, and payments."
        />
      </div>
    </>
  )
}
