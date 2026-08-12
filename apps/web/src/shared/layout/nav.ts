import type { ModuleKey } from '@ipc/permissions'
import type { AppRole } from '@ipc/permissions'
import {
  LayoutDashboard,
  KanbanSquare,
  CalendarClock,
  Database,
  Briefcase,
  Plus,
  Target,
  ListChecks,
  Camera,
  ListTodo,
  CreditCard,
  Receipt,
  Wallet,
  TrendingUp,
  Contact,
  Bell,
  Megaphone,
  Users,
  Clock,
  Settings,
  Building2,
  type LucideIcon,
} from 'lucide-react'

export interface NavLeaf {
  kind: 'leaf'
  label: string
  to: string
  icon?: LucideIcon
  module?: ModuleKey
  roles?: AppRole[]
  /** Cross-tenant vendor console — gated on platform_admins, NOT a module. */
  platformOnly?: boolean
}

export interface NavGroup {
  kind: 'group'
  label: string
  icon?: LucideIcon
  /** Path prefix that auto-opens this group. */
  match: string
  children: NavLeaf[]
  roles?: AppRole[]
  /** Cross-tenant vendor console — gated on platform_admins, NOT a module. */
  platformOnly?: boolean
}

export type NavEntry = NavLeaf | NavGroup

const leaf = (
  label: string,
  to: string,
  icon: LucideIcon,
  extra: Partial<NavLeaf> = {},
): NavLeaf => ({ kind: 'leaf', label, to, icon, ...extra })

/**
 * The single sidebar source. Trimming here is cosmetic — hidden routes are
 * still guarded by ModuleRouteGuard + the API. Employees get a flat personal
 * set; admins/managers get workflow groups.
 */
export const NAV: NavEntry[] = [
  leaf('Dashboard', '/dashboard', LayoutDashboard, { module: 'dashboard' }),

  // Employee-only personal set.
  leaf('My Work', '/my-work', ListTodo, { roles: ['employee'] }),
  leaf('My Tasks', '/tasks/my', ListTodo, { roles: ['employee'] }),
  leaf('My Shoots', '/shoots/my', Camera, { roles: ['employee'] }),

  {
    kind: 'group',
    label: 'Production',
    icon: KanbanSquare,
    match: '/production',
    children: [
      leaf('Production Board', '/production-board', KanbanSquare, { module: 'projects' }),
      leaf('Team Booking', '/team-allocation', CalendarClock, { module: 'projects' }),
      leaf('Data Management', '/data-management', Database, { module: 'projects' }),
    ],
  },
  {
    kind: 'group',
    label: 'Projects',
    icon: Briefcase,
    match: '/projects',
    children: [
      leaf('All Projects', '/projects', Briefcase, { module: 'projects' }),
      leaf('Create Project', '/projects/new', Plus, { module: 'projects' }),
      leaf('Project Tracking', '/project-tracking', Target, { module: 'projects' }),
    ],
  },

  leaf('Task Management', '/tasks', ListChecks, { module: 'tasks' }),

  {
    kind: 'group',
    label: 'Billing',
    icon: CreditCard,
    match: '/billing',
    children: [
      leaf('Payments', '/billing', Receipt, { module: 'billing' }),
      leaf('Expenses', '/company-expenses', Wallet, { module: 'company_expenses' }),
      leaf('Profitability', '/financials', TrendingUp, { module: 'financials' }),
    ],
  },
  {
    kind: 'group',
    label: 'CRM & Clients',
    icon: Contact,
    match: '/clients',
    children: [
      leaf('CRM', '/follow-ups', Bell, { module: 'crm' }),
      leaf('Clients', '/clients', Contact, { module: 'clients' }),
      leaf('Lead Sources', '/facebook', Megaphone, { module: 'lead_sources' }),
    ],
  },
  {
    kind: 'group',
    label: 'Team',
    icon: Users,
    match: '/employees',
    children: [
      leaf('Team Directory', '/employees', Users, { module: 'team_directory' }),
      leaf('Attendance', '/attendance', Clock, { module: 'attendance' }),
    ],
  },

  leaf('Alerts', '/notifications', Bell, { module: 'crm' }),
  leaf('Settings', '/settings/company', Settings, { module: 'settings' }),

  {
    kind: 'group',
    label: 'Platform',
    icon: Building2,
    match: '/platform',
    platformOnly: true,
    children: [
      leaf('Studios', '/platform/studios', Building2, { platformOnly: true }),
      leaf('Usage', '/platform/usage', TrendingUp, { platformOnly: true }),
    ],
  },
]
