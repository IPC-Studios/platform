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
  route('/my-work', comingSoon('My work', 'projects', 'Phase 8')),
  route('/production-board', ProductionBoardPage),
  route('/data-management', comingSoon('Data management', 'projects', 'Phase 7')),
  route('/team-allocation', comingSoon('Team allocation', 'projects', 'Phase 6')),
  route('/follow-ups', comingSoon('Follow-ups', 'crm', 'Phase 11')),
  route('/facebook', comingSoon('Lead sources', 'lead_sources', 'Phase 11')),
  route('/employees', comingSoon('Team directory', 'team_directory', 'Phase 12')),
  route('/attendance', comingSoon('Attendance', 'attendance', 'Phase 12')),
  route('/billing', comingSoon('Billing', 'billing', 'Phase 9')),
  route('/company-expenses', comingSoon('Company expenses', 'company_expenses', 'Phase 10')),
  route('/financials', comingSoon('Financials', 'financials', 'Phase 10')),
  route('/notifications', comingSoon('Alerts', 'crm', 'Phase 13')),
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
