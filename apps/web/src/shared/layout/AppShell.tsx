import { useEffect, useState, type ReactNode } from 'react'
import { Link, useLocation } from '@tanstack/react-router'
import { Menu, Moon, Sun, LogOut, ChevronDown, ChevronsLeft, ChevronsRight, X } from 'lucide-react'
import type { ModuleKey } from '@ipc/permissions'
import { useAuth } from '../auth/AuthProvider'
import { useAccess } from '../auth/useAccess'
import { useTheme } from '../theme/ThemeProvider'
import { Button } from '../ui/button'
import { cn } from '../ui/cn'
import { NAV, type NavEntry, type NavGroup, type NavLeaf } from './nav'

type Access = ReturnType<typeof useAccess>

const COLLAPSE_KEY = 'ipc.sidebar.collapsed'

function leafVisible(leaf: NavLeaf, role: string, access: Access, isPlatformAdmin: boolean): boolean {
  if (leaf.platformOnly) return isPlatformAdmin
  if (leaf.roles && !leaf.roles.includes(role as never)) return false
  if (leaf.module && !access.hasModule(leaf.module as ModuleKey)) return false
  return true
}

/** Drop entries failing role/module/platform checks; drop groups left empty. */
function filterNav(
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

const matches = (pathname: string, to: string) =>
  pathname === to || pathname.startsWith(to + '/')

/**
 * Only the deepest match lights up: on /projects/new both "All Projects"
 * (/projects) and "Create Project" prefix-match, and two lit rows read as a
 * bug.
 */
function activeTarget(entries: NavEntry[], pathname: string): string | null {
  let best: string | null = null
  const consider = (to: string) => {
    if (matches(pathname, to) && (best === null || to.length > best.length)) best = to
  }
  for (const e of entries) {
    if (e.kind === 'leaf') consider(e.to)
    else for (const c of e.children) consider(c.to)
  }
  return best
}

function Brand({ compact }: { compact?: boolean }) {
  return (
    <span className="whitespace-nowrap text-lg font-bold tracking-tight">
      <span className="text-brand">IPC</span>
      {!compact && ' Studios'}
    </span>
  )
}

export function AppShell({ children }: { children: ReactNode }) {
  const { session, signOut } = useAuth()
  const access = useAccess()
  const { scheme, toggleScheme } = useTheme()
  const [mobileOpen, setMobileOpen] = useState(false)
  const [collapsed, setCollapsed] = useState(
    () => globalThis.localStorage?.getItem(COLLAPSE_KEY) === '1',
  )
  const role = session?.role ?? 'none'
  const entries = filterNav(NAV, role, access, session?.is_platform_admin ?? false)

  useEffect(() => {
    globalThis.localStorage?.setItem(COLLAPSE_KEY, collapsed ? '1' : '0')
  }, [collapsed])

  return (
    <div className="flex h-screen overflow-hidden bg-background print:block print:h-auto print:overflow-visible">
      <Sidebar
        entries={entries}
        onSignOut={() => void signOut()}
        collapsed={collapsed}
        onToggleCollapse={() => setCollapsed((c) => !c)}
        className="hidden md:flex"
      />

      {mobileOpen && (
        <>
          <div className="fixed inset-0 z-40 bg-black/40 md:hidden" onClick={() => setMobileOpen(false)} />
          <Sidebar
            entries={entries}
            onSignOut={() => void signOut()}
            collapsed={false}
            onClose={() => setMobileOpen(false)}
            className="fixed inset-y-0 left-0 z-50 flex md:hidden"
          />
        </>
      )}

      <div className="flex min-w-0 flex-1 flex-col overflow-hidden print:overflow-visible">
        <header className="flex h-14 shrink-0 items-center gap-2 border-b border-border bg-card px-4">
          <Button variant="ghost" size="icon" className="md:hidden" onClick={() => setMobileOpen(true)}>
            <Menu />
          </Button>
          <span className="md:hidden">
            <Brand />
          </span>
          <div className="ml-auto flex items-center gap-1">
            <Button variant="ghost" size="icon" onClick={toggleScheme} aria-label="Toggle theme">
              {scheme === 'dark' ? <Sun /> : <Moon />}
            </Button>
            <span className="hidden px-2 text-sm text-muted-foreground sm:inline">
              {session?.display_name}
            </span>
          </div>
        </header>

        {session?.plan_gate === 'grace' && (
          <div className="shrink-0 bg-warning/15 px-4 py-2 text-center text-sm text-warning">
            Your plan is in its grace period. Renew soon to avoid interruption.
          </div>
        )}

        <main className="min-w-0 flex-1 overflow-y-auto p-4 md:p-6 print:overflow-visible">{children}</main>
      </div>
    </div>
  )
}

function Sidebar({
  entries,
  onSignOut,
  collapsed,
  onToggleCollapse,
  onClose,
  className,
}: {
  entries: NavEntry[]
  onSignOut: () => void
  collapsed: boolean
  onToggleCollapse?: () => void
  onClose?: () => void
  className?: string
}) {
  const { pathname } = useLocation()
  const active = activeTarget(entries, pathname)
  return (
    <aside
      className={cn(
        'shrink-0 flex-col overflow-hidden border-r border-border bg-sidebar text-sidebar-foreground transition-[width] duration-200',
        collapsed ? 'w-[4.5rem]' : 'w-72',
        className,
      )}
    >
      <div className={cn('flex h-14 shrink-0 items-center border-b border-border px-4', collapsed && 'px-0')}>
        {collapsed ? (
          <button
            type="button"
            onClick={onToggleCollapse}
            aria-label="Expand sidebar"
            className="mx-auto flex size-10 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-foreground"
          >
            <ChevronsRight className="size-5" />
          </button>
        ) : (
          <>
            <Brand />
            {onToggleCollapse && (
              <button
                type="button"
                onClick={onToggleCollapse}
                aria-label="Collapse sidebar"
                className="ml-auto flex size-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-foreground"
              >
                <ChevronsLeft className="size-5" />
              </button>
            )}
            {onClose && (
              <button
                type="button"
                onClick={onClose}
                aria-label="Close menu"
                className="ml-auto flex size-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-foreground"
              >
                <X className="size-5" />
              </button>
            )}
          </>
        )}
      </div>

      {!collapsed && (
        <p className="px-4 pb-1 pt-4 text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
          Menu
        </p>
      )}

      <nav className={cn('flex flex-1 flex-col gap-1 overflow-y-auto px-3 pb-3', collapsed && 'px-2 pt-3')}>
        {entries.map((e) =>
          e.kind === 'leaf' ? (
            <NavItem
              key={e.to}
              to={e.to}
              label={e.label}
              icon={e.icon}
              active={e.to === active}
              collapsed={collapsed}
            />
          ) : (
            <Group
              key={e.label}
              group={e}
              active={active}
              collapsed={collapsed}
              onExpand={onToggleCollapse}
            />
          ),
        )}
      </nav>

      <div className={cn('border-t border-border p-3', collapsed && 'px-2')}>
        <button
          type="button"
          onClick={onSignOut}
          title={collapsed ? 'Log out' : undefined}
          className={cn(
            'flex w-full items-center gap-3 whitespace-nowrap rounded-lg px-3 py-2.5 text-[15px] font-medium text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-foreground',
            collapsed && 'justify-center px-0',
          )}
        >
          <LogOut className="size-[18px] shrink-0" />
          {!collapsed && 'Log out'}
        </button>
      </div>
    </aside>
  )
}

function Group({
  group,
  active,
  collapsed,
  onExpand,
}: {
  group: NavGroup
  active: string | null
  collapsed: boolean
  onExpand?: (() => void) | undefined
}) {
  const hasActive = group.children.some((c) => c.to === active)
  const [open, setOpen] = useState(true)
  const Icon = group.icon

  // Collapsed: the group icon is a stub — clicking it reopens the rail with the
  // group expanded, so no child route is stranded behind the collapse.
  return (
    <div className={cn(!collapsed && 'mt-1')}>
      <button
        type="button"
        onClick={() => {
          if (collapsed) {
            setOpen(true)
            onExpand?.()
          } else {
            setOpen((o) => !o)
          }
        }}
        title={collapsed ? group.label : undefined}
        className={cn(
          'flex w-full items-center gap-3 whitespace-nowrap rounded-lg px-3 py-2.5 text-[15px] font-medium transition-colors hover:bg-sidebar-accent',
          hasActive ? 'text-foreground' : 'text-muted-foreground',
          collapsed && 'justify-center px-0',
        )}
      >
        {Icon && <Icon className="size-[18px] shrink-0" />}
        {!collapsed && (
          <>
            <span className="flex-1 text-left">{group.label}</span>
            <ChevronDown className={cn('size-4 transition-transform', open ? '' : '-rotate-90')} />
          </>
        )}
      </button>
      {open && !collapsed && (
        <div className="mt-1 ml-[1.4rem] space-y-1 border-l border-border pl-3">
          {group.children.map((c) => (
            <NavItem
              key={c.to}
              to={c.to}
              label={c.label}
              icon={c.icon}
              active={c.to === active}
              collapsed={false}
            />
          ))}
        </div>
      )}
    </div>
  )
}

function NavItem({
  to,
  label,
  icon: Icon,
  active,
  collapsed,
}: {
  to: string
  label: string
  icon?: NavLeaf['icon']
  active: boolean
  collapsed: boolean
}) {
  return (
    <Link
      to={to}
      title={collapsed ? label : undefined}
      className={cn(
        'flex items-center gap-3 whitespace-nowrap rounded-lg px-3 py-2.5 text-[15px] font-medium transition-colors',
        active
          ? 'bg-primary/10 text-primary'
          : 'text-muted-foreground hover:bg-sidebar-accent hover:text-foreground',
        collapsed && 'justify-center px-0',
      )}
    >
      {Icon && <Icon className="size-[18px] shrink-0" />}
      {!collapsed && label}
    </Link>
  )
}
