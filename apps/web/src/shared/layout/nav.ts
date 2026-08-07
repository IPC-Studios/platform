import type { ModuleKey } from '@ipc/permissions'
import type { AppRole } from '@ipc/permissions'
import {
  LayoutDashboard,
  FolderKanban,
  Camera,
  ListTodo,
  KanbanSquare,
  CalendarClock,
  HardDrive,
  Users,
  Clock,
  Contact,
  Megaphone,
  Receipt,
  Wallet,
  TrendingUp,
  Bell,
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
}

export interface NavGroup {
  kind: 'group'
  label: string
  icon?: LucideIcon
  /** Path prefix that auto-opens this group. */
  match: string
  children: NavLeaf[]
  roles?: AppRole[]
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
    label: 'Projects',
    icon: FolderKanban,
    match: '/projects',
    children: [
      leaf('Projects', '/projects', FolderKanban, { module: 'projects' }),
      leaf('Shoots', '/shoots', Camera, { module: 'projects' }),
      leaf('Tasks', '/tasks', ListTodo, { module: 'tasks' }),
    ],
  },
  {
    kind: 'group',
    label: 'Production',
    icon: KanbanSquare,
    match: '/production',
    children: [
      leaf('Board', '/production-board', KanbanSquare, { module: 'projects' }),
      leaf('Data', '/data-management', HardDrive, { module: 'projects' }),
      leaf('Allocation', '/team-allocation', CalendarClock, { module: 'projects' }),
    ],
  },
  {
    kind: 'group',
    label: 'Clients & CRM',
    icon: Contact,
    match: '/clients',
    children: [
      leaf('Clients', '/clients', Contact, { module: 'clients' }),
      leaf('Follow-ups', '/follow-ups', Megaphone, { module: 'crm' }),
      leaf('Lead sources', '/facebook', Megaphone, { module: 'lead_sources' }),
    ],
  },
  {
    kind: 'group',
    label: 'Team',
    icon: Users,
    match: '/employees',
    children: [
      leaf('Directory', '/employees', Users, { module: 'team_directory' }),
      leaf('Attendance', '/attendance', Clock, { module: 'attendance' }),
    ],
  },
  {
    kind: 'group',
    label: 'Money',
    icon: Wallet,
    match: '/billing',
    children: [
      leaf('Billing', '/billing', Receipt, { module: 'billing' }),
      leaf('Company expenses', '/company-expenses', Wallet, { module: 'company_expenses' }),
      leaf('Financials', '/financials', TrendingUp, { module: 'financials' }),
    ],
  },

  leaf('Alerts', '/notifications', Bell, { module: 'crm' }),
  leaf('Settings', '/settings/company', Settings, { module: 'settings' }),
  leaf('Platform', '/platform/studios', Building2, { module: 'studio_access' }),
]
