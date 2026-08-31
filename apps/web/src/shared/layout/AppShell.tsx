import { useState, type ReactNode } from 'react'
import { Link, useLocation } from '@tanstack/react-router'
import { Menu, Moon, Sun, LogOut, ChevronDown } from 'lucide-react'
import type { ModuleKey } from '@ipc/permissions'
import { useAuth } from '../auth/AuthProvider'
import { useAccess } from '../auth/useAccess'
import { useTheme } from '../theme/ThemeProvider'
import { Button } from '../ui/button'
import { cn } from '../ui/cn'
import { NAV, type NavEntry, type NavGroup, type NavLeaf } from './nav'

type Access = ReturnType<typeof useAccess>

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

const isActive = (pathname: string, to: string) =>
  pathname === to || pathname.startsWith(to + '/')

export function AppShell({ children }: { children: ReactNode }) {
  const { session, signOut } = useAuth()
  const access = useAccess()
  const { scheme, toggleScheme } = useTheme()
  const [mobileOpen, setMobileOpen] = useState(false)
  const role = session?.role ?? 'none'
  const entries = filterNav(NAV, role, access, session?.is_platform_admin ?? false)

  return (
    <div className="flex min-h-screen bg-background">
      <Sidebar entries={entries} onSignOut={() => void signOut()} className="hidden md:flex" />

      {mobileOpen && (
        <>
          <div className="fixed inset-0 z-40 bg-black/40 md:hidden" onClick={() => setMobileOpen(false)} />
          <Sidebar
            entries={entries}
            onSignOut={() => void signOut()}
            className="fixed inset-y-0 left-0 z-50 flex md:hidden"
          />
        </>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 items-center gap-2 border-b border-border px-4">
          <Button variant="ghost" size="icon" className="md:hidden" onClick={() => setMobileOpen(true)}>
            <Menu />
          </Button>
          <span className="text-xl font-bold tracking-tight">
            <span className="text-brand">IPC</span> Studios
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
          <div className="bg-warning/15 px-4 py-2 text-center text-sm text-warning">
            Your plan is in its grace period. Renew soon to avoid interruption.
          </div>
        )}

        <main className="min-w-0 flex-1 p-4 md:p-6">{children}</main>
      </div>
    </div>
  )
}

function Sidebar({
  entries,
  onSignOut,
  className,
}: {
  entries: NavEntry[]
  onSignOut: () => void
  className?: string
}) {
  const { pathname } = useLocation()
  return (
    <aside
      className={cn(
        'w-60 shrink-0 flex-col border-r border-border bg-sidebar p-3 text-sidebar-foreground',
        className,
      )}
    >
      <p className="px-3 pb-2 pt-1 text-xs font-semibold uppercase tracking-widest text-muted-foreground">
        Menu
      </p>
      <nav className="flex flex-1 flex-col gap-0.5 overflow-y-auto">
        {entries.map((e) =>
          e.kind === 'leaf' ? (
            <NavItem key={e.to} to={e.to} label={e.label} icon={e.icon} active={isActive(pathname, e.to)} />
          ) : (
            <Group key={e.label} group={e} pathname={pathname} />
          ),
        )}
      </nav>
      <button
        type="button"
        onClick={onSignOut}
        className="mt-2 flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-foreground"
      >
        <LogOut className="size-4" />
        Log out
      </button>
    </aside>
  )
}

function Group({ group, pathname }: { group: NavGroup; pathname: string }) {
  const hasActive = group.children.some((c) => isActive(pathname, c.to))
  const [open, setOpen] = useState(true)
  const Icon = group.icon
  return (
    <div className="mt-1">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className={cn(
          'flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-colors hover:bg-sidebar-accent',
          hasActive ? 'text-foreground' : 'text-muted-foreground',
        )}
      >
        {Icon && <Icon className="size-4" />}
        <span className="flex-1 text-left">{group.label}</span>
        <ChevronDown className={cn('size-4 transition-transform', open ? '' : '-rotate-90')} />
      </button>
      {open && (
        <div className="mt-0.5 ml-4 space-y-0.5 border-l border-border pl-2">
          {group.children.map((c) => (
            <NavItem key={c.to} to={c.to} label={c.label} icon={c.icon} active={isActive(pathname, c.to)} />
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
}: {
  to: string
  label: string
  icon?: NavLeaf['icon']
  active: boolean
}) {
  return (
    <Link
      to={to}
      className={cn(
        'flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-colors',
        active
          ? 'bg-primary/10 text-primary'
          : 'text-muted-foreground hover:bg-sidebar-accent hover:text-foreground',
      )}
    >
      {Icon && <Icon className="size-4" />}
      {label}
    </Link>
  )
}
