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
import { VerifyEmailPage } from '@/routes/verify'
import { ResetPasswordPage } from '@/routes/reset-password'
import { AcceptInvitePage } from '@/routes/accept-invite'
import { DashboardPage } from '@/routes/dashboard'
import { ProjectsListPage } from '@/routes/projects/list'
import { NewProjectPage } from '@/routes/projects/new'
import { ProjectDetailPage } from '@/routes/projects/detail'
import { ProjectTrackingPage } from '@/routes/project-tracking'
import { LeadSourcesPage } from '@/routes/lead-sources'
import { ShootsPage } from '@/routes/shoots'
import { ClientsListPage } from '@/routes/clients/list'
import { ProductionBoardPage } from '@/routes/production-board'
import { TasksPage } from '@/routes/tasks'
import { TeamAllocationPage } from '@/routes/team-allocation'
import { DataManagementPage } from '@/routes/data-management'
import { MyWorkPage } from '@/routes/my-work'
import { BillingPage } from '@/routes/billing'
import { InvoiceDetailPage } from '@/routes/invoice-detail'
import { CompanyExpensesPage } from '@/routes/company-expenses'
import { FinancialsPage } from '@/routes/financials'
import { FollowUpsPage } from '@/routes/follow-ups'
import { AttendancePage } from '@/routes/attendance'
import { NotificationsPage } from '@/routes/notifications'
import { EmployeesPage } from '@/routes/employees'
import { SubscriptionPage } from '@/routes/subscription'
import { SettingsPage } from '@/routes/settings'
import { RolesAccessPage } from '@/routes/settings/roles'
import { AppearancePage } from '@/routes/settings/appearance'
import { TermsAcknowledgePage } from '@/routes/terms-acknowledge'
import { PlatformStudiosPage } from '@/routes/platform/studios'
import { PlatformUsagePage } from '@/routes/platform/usage'
import { comingSoon } from '@/routes/coming-soon'
import { RequireAuth } from '@/shared/auth/guards'
import { AppShell } from '@/shared/layout/AppShell'

const rootRoute = createRootRoute({
  component: Outlet,
  notFoundComponent: NotFound,
})

/**
 * The signed-in shell, mounted once.
 *
 * Every authed page used to render its own <RequireAuth><AppShell>, so a
 * navigation tore the whole sidebar down and rebuilt it — resetting anything it
 * held and re-running every mount effect. As a pathless layout route the shell
 * stays put and only the <Outlet/> swaps.
 */
function AuthedShell() {
  return (
    <RequireAuth>
      <AppShell>
        <Outlet />
      </AppShell>
    </RequireAuth>
  )
}

/**
 * The same shell with the plan gate lifted — the renewal page has to stay
 * reachable precisely when the plan has lapsed, or the recovery path is behind
 * the thing it recovers from.
 */
function RenewalShell() {
  return (
    <RequireAuth allowExpired>
      <AppShell>
        <Outlet />
      </AppShell>
    </RequireAuth>
  )
}

const authedLayout = createRoute({
  getParentRoute: () => rootRoute,
  id: 'authed',
  component: AuthedShell,
})

const renewalLayout = createRoute({
  getParentRoute: () => rootRoute,
  id: 'renewal',
  component: RenewalShell,
})

/** Public: no session, no shell. */
const publicRoute = (path: string, component: () => ReactNode): AnyRoute =>
  createRoute({ getParentRoute: () => rootRoute, path, component })

/** Signed in: the shell is already around it. */
const route = (path: string, component: () => ReactNode): AnyRoute =>
  createRoute({ getParentRoute: () => authedLayout, path, component })

const routeTree = rootRoute.addChildren([
  publicRoute('/login', LoginPage),
  publicRoute('/verify', VerifyEmailPage),
  publicRoute('/reset-password', ResetPasswordPage),
  publicRoute('/accept-invite', AcceptInvitePage),
  publicRoute('/terms/acknowledge', TermsAcknowledgePage),

  renewalLayout.addChildren([
    createRoute({
      getParentRoute: () => renewalLayout,
      path: '/settings/subscription',
      component: SubscriptionPage,
    }),
  ]),

  authedLayout.addChildren([
  route('/', DashboardPage),
  route('/dashboard', DashboardPage),

  route('/projects', ProjectsListPage),
  route('/projects/new', NewProjectPage),
  route('/projects/$id', ProjectDetailPage),
  route('/project-tracking', ProjectTrackingPage),
  route('/clients', ClientsListPage),

  // Nav destinations whose feature phase isn't built yet.
  route('/shoots', ShootsPage),
  route('/tasks', TasksPage),
  route('/tasks/my', comingSoon('My tasks', 'tasks', 'Phase 12')),
  route('/shoots/my', comingSoon('My shoots', 'projects', 'a later phase')),
  route('/my-work', MyWorkPage),
  route('/production-board', ProductionBoardPage),
  route('/data-management', DataManagementPage),
  route('/team-allocation', TeamAllocationPage),
  route('/follow-ups', FollowUpsPage),
  route('/lead-sources', LeadSourcesPage),
  // The permissions matrix has declared /facebook as this module's path since
  // Phase 2; keep it working rather than breaking anyone's bookmark.
  route('/facebook', LeadSourcesPage),
  route('/employees', EmployeesPage),
  route('/attendance', AttendancePage),
  route('/billing', BillingPage),
  route('/billing/invoices/$id', InvoiceDetailPage),
  route('/company-expenses', CompanyExpensesPage),
  route('/financials', FinancialsPage),
  route('/notifications', NotificationsPage),
  route('/settings/company', SettingsPage),
  route('/settings/roles', RolesAccessPage),
  route('/settings/appearance', AppearancePage),
  route('/platform/studios', PlatformStudiosPage),
  route('/platform/usage', PlatformUsagePage),
  ]),
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
