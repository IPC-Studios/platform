import type { ReactNode } from 'react'
import {
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  Link,
  type AnyRoute,
} from '@tanstack/react-router'
import { LoginPage } from '@/routes/login'
import { DashboardPage } from '@/routes/dashboard'
import { ProjectsListPage } from '@/routes/projects/list'
import { NewProjectPage } from '@/routes/projects/new'
import { ProjectDetailPage } from '@/routes/projects/detail'
import { ClientsListPage } from '@/routes/clients/list'
import { ProductionBoardPage } from '@/routes/production-board'
import { TeamAllocationPage } from '@/routes/team-allocation'
import { DataManagementPage } from '@/routes/data-management'
import { MyWorkPage } from '@/routes/my-work'
import { BillingPage } from '@/routes/billing'
import { CompanyExpensesPage } from '@/routes/company-expenses'
import { FinancialsPage } from '@/routes/financials'
import { FollowUpsPage } from '@/routes/follow-ups'
import { AttendancePage } from '@/routes/attendance'
import { NotificationsPage } from '@/routes/notifications'
import { comingSoon } from '@/routes/coming-soon'

const rootRoute = createRootRoute({
  component: Outlet,
  notFoundComponent: NotFound,
})

const route = (path: string, component: () => ReactNode): AnyRoute =>
  createRoute({ getParentRoute: () => rootRoute, path, component })

const routeTree = rootRoute.addChildren([
  route('/', DashboardPage),
  route('/login', LoginPage),
  route('/dashboard', DashboardPage),

  route('/projects', ProjectsListPage),
  route('/projects/new', NewProjectPage),
  route('/projects/$id', ProjectDetailPage),
  route('/clients', ClientsListPage),

  // Nav destinations whose feature phase isn't built yet.
  route('/shoots', comingSoon('Shoots', 'projects', 'a later phase')),
  route('/tasks', ProductionBoardPage),
  route('/tasks/my', comingSoon('My tasks', 'tasks', 'Phase 12')),
  route('/shoots/my', comingSoon('My shoots', 'projects', 'a later phase')),
  route('/my-work', MyWorkPage),
  route('/production-board', ProductionBoardPage),
  route('/data-management', DataManagementPage),
  route('/team-allocation', TeamAllocationPage),
  route('/follow-ups', FollowUpsPage),
  route('/facebook', comingSoon('Lead sources', 'lead_sources', 'Phase 11')),
  route('/employees', comingSoon('Team directory', 'team_directory', 'Phase 12')),
  route('/attendance', AttendancePage),
  route('/billing', BillingPage),
  route('/company-expenses', CompanyExpensesPage),
  route('/financials', FinancialsPage),
  route('/notifications', NotificationsPage),
  route('/settings/company', comingSoon('Settings', 'settings', 'a later phase')),
  route('/platform/studios', comingSoon('Platform', 'studio_access', 'Phase 14')),
])

export const router = createRouter({ routeTree })

function NotFound() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-3 text-center font-sans">
      <h1 className="text-2xl font-semibold">Page not found</h1>
      <p className="text-muted-foreground">That page doesn’t exist.</p>
      <Link to="/dashboard" className="text-primary hover:underline">
        Go to dashboard
      </Link>
    </div>
  )
}

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router
  }
}
