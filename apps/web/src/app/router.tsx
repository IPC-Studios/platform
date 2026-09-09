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
import { GopoPage } from '@/routes/financials/gopo'
import { GstAnalysisPage } from '@/routes/financials/gst-analysis'
import { CalculatedExpensesPage } from '@/routes/financials/calculated-expenses'
import { FollowUpsPage } from '@/routes/follow-ups'
import { CrmContactsPage } from '@/routes/crm/contacts'
import { CrmCompaniesPage } from '@/routes/crm/companies'
import { AttendancePage } from '@/routes/attendance'
import { NotificationsPage } from '@/routes/notifications'
import { EmployeesPage } from '@/routes/employees'
import { SubscriptionPage } from '@/routes/subscription'
import { SettingsPage } from '@/routes/settings'
import { RolesAccessPage } from '@/routes/settings/roles'
import { TeamTermsPage } from '@/routes/settings/team-terms'
import { AppearancePage } from '@/routes/settings/appearance'
import { TermsAcknowledgePage } from '@/routes/terms-acknowledge'
import { QuoteAcceptPage } from '@/routes/quote-accept'
import { TeamTermsAcknowledgePage } from '@/routes/team-terms-acknowledge'
import { QuotationPage } from '@/routes/quotation'
import { EnquiriesPage } from '@/routes/enquiries'
import { PersonalExpensesPage } from '@/routes/personal-expenses'
import { ReceiptPage } from '@/routes/receipt'
import { DeliveryPage } from '@/routes/delivery'
import { ReferPage } from '@/routes/refer'
import { ProjectDocumentsPage } from '@/routes/project-documents'
import { TeamWorkPreviewPage } from '@/routes/team-work-preview'
import { PlatformStudiosPage } from '@/routes/platform/studios'
import { PlatformUsagePage } from '@/routes/platform/usage'
import { SystemPage } from '@/routes/settings/system'
import { ReferralsPage } from '@/routes/referrals'
import { ProjectTemplatesPage } from '@/routes/project-templates'
import { TeamPayoutsPage } from '@/routes/team-payouts'
import { RemindersPage } from '@/routes/reminders'
import { ActivityPage } from '@/routes/activity'
import { InvoiceTemplatesPage } from '@/routes/billing/templates'
import { MyTasksPage } from '@/routes/tasks/my'
import { MyShootsPage } from '@/routes/shoots/my'
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
  publicRoute('/quote/accept', QuoteAcceptPage),
  publicRoute('/team-terms', TeamTermsAcknowledgePage),
  publicRoute('/quotation', QuotationPage),
  publicRoute('/receipt', ReceiptPage),
  publicRoute('/delivery', DeliveryPage),
  publicRoute('/refer/$slug', ReferPage),

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
  route('/project-documents', ProjectDocumentsPage),
  route('/team/work-preview', TeamWorkPreviewPage),
  route('/clients', ClientsListPage),

  route('/shoots', ShootsPage),
  route('/shoots/my', MyShootsPage),
  route('/tasks', TasksPage),
  route('/tasks/my', MyTasksPage),
  route('/my-work', MyWorkPage),
  route('/production-board', ProductionBoardPage),
  route('/data-management', DataManagementPage),
  route('/team-allocation', TeamAllocationPage),
  route('/follow-ups', FollowUpsPage),
  route('/crm/contacts', CrmContactsPage),
  route('/crm/companies', CrmCompaniesPage),
  route('/lead-sources', LeadSourcesPage),
  // The permissions matrix has declared /facebook as this module's path since
  // Phase 2; keep it working rather than breaking anyone's bookmark.
  route('/facebook', LeadSourcesPage),
  route('/employees', EmployeesPage),
  route('/attendance', AttendancePage),
  route('/billing', BillingPage),
  route('/billing/templates', InvoiceTemplatesPage),
  route('/billing/invoices/$id', InvoiceDetailPage),
  route('/company-expenses', CompanyExpensesPage),
  route('/financials', FinancialsPage),
  route('/financials/gopo', GopoPage),
  route('/financials/gst-analysis', GstAnalysisPage),
  route('/financials/calculated-expenses', CalculatedExpensesPage),
  route('/notifications', NotificationsPage),
  route('/settings/company', SettingsPage),
  route('/settings/roles', RolesAccessPage),
  route('/settings/team-terms', TeamTermsPage),
  route('/enquiries', EnquiriesPage),
  route('/personal-expenses', PersonalExpensesPage),
  route('/settings/appearance', AppearancePage),
  route('/settings/system', SystemPage),
  route('/referrals', ReferralsPage),
  route('/settings/project-templates', ProjectTemplatesPage),
  route('/team-payouts', TeamPayoutsPage),
  route('/reminders', RemindersPage),
  route('/activity', ActivityPage),
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
