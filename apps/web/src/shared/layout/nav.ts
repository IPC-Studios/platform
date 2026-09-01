import type { ModuleKey } from '@ipc/permissions'
import type { useAccess } from '../auth/useAccess'
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
  ShieldCheck,
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

type Access = ReturnType<typeof useAccess>

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
      leaf('Lead Sources', '/lead-sources', Megaphone, { module: 'lead_sources' }),
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
      leaf('Roles & Access', '/settings/roles', ShieldCheck, { module: 'team_roles' }),
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

function leafVisible(leaf: NavLeaf, role: string, access: Access, isPlatformAdmin: boolean): boolean {
  if (leaf.platformOnly) return isPlatformAdmin
  if (leaf.roles && !leaf.roles.includes(role as never)) return false
  if (leaf.module && !access.hasModule(leaf.module as ModuleKey)) return false
  return true
}

/** Drop entries failing role/module/platform checks; drop groups left empty. */
export function filterNav(
  entries: NavEntry[],
  role: string,
  access: Access,
  isPlatformAdmin: boolean,
): NavEntry[] {
  const out: NavEntry[] = []
  for (const e of entries) {
    if (e.kind === 'leaf') {
      if (leafVisible(e, role, access, isPlatformAdmin)) out.push(e)
    } else {
      if (e.platformOnly && !isPlatformAdmin) continue
      if (e.roles && !e.roles.includes(role as never)) continue
      const children = e.children.filter((c) => leafVisible(c, role, access, isPlatformAdmin))
      if (children.length) out.push({ ...e, children })
    }
  }
  return out
}

/** Every destination this user can actually open, flattened for searching. */
export function navDestinations(
  role: string,
  access: Access,
  isPlatformAdmin: boolean,
): NavLeaf[] {
  const out: NavLeaf[] = []
  for (const e of filterNav(NAV, role, access, isPlatformAdmin)) {
    if (e.kind === 'leaf') out.push(e)
    else out.push(...e.children)
  }
  return out
}
