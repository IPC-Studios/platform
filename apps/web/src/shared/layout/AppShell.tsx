import { useState, type ReactNode } from 'react'
import { Link, useLocation } from '@tanstack/react-router'
import { Menu, Moon, Sun, LogOut } from 'lucide-react'
import type { ModuleKey } from '@ipc/permissions'
import { useAuth } from '../auth/AuthProvider'
import { useAccess } from '../auth/useAccess'
import { useTheme } from '../theme/ThemeProvider'
import { Button } from '../ui/button'
import { cn } from '../ui/cn'
import { NAV, type NavEntry, type NavLeaf } from './nav'

type Access = ReturnType<typeof useAccess>

function leafVisible(leaf: NavLeaf, role: string, access: Access): boolean {
  if (leaf.roles && !leaf.roles.includes(role as never)) return false
  if (leaf.module && !access.hasModule(leaf.module as ModuleKey)) return false
  return true
}

/** Drop entries failing role/module checks; drop groups left empty. */
function filterNav(entries: NavEntry[], role: string, access: Access): NavEntry[] {
  const out: NavEntry[] = []
  for (const e of entries) {
    if (e.kind === 'leaf') {
      if (leafVisible(e, role, access)) out.push(e)
    } else {
      if (e.roles && !e.roles.includes(role as never)) continue
      const children = e.children.filter((c) => leafVisible(c, role, access))
      if (children.length) out.push({ ...e, children })
    }
  }
  return out
}

export function AppShell({ children }: { children: ReactNode }) {
  const { session, signOut } = useAuth()
  const access = useAccess()
  const { scheme, toggleScheme } = useTheme()
  const [mobileOpen, setMobileOpen] = useState(false)
  const role = session?.role ?? 'none'
  const entries = filterNav(NAV, role, access)

  return (
    <div className="flex min-h-screen bg-background">
      <Sidebar entries={entries} className="hidden md:flex" />

      {mobileOpen && (
        <>
          <div className="fixed inset-0 z-40 bg-black/40 md:hidden" onClick={() => setMobileOpen(false)} />
          <Sidebar entries={entries} className="fixed inset-y-0 left-0 z-50 flex md:hidden" />
        </>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 items-center gap-2 border-b border-border px-4">
          <Button variant="ghost" size="icon" className="md:hidden" onClick={() => setMobileOpen(true)}>
            <Menu />
          </Button>
          <span className="font-semibold" style={{ color: 'oklch(0.78 0.16 75)' }}>
            IPC Studios
          </span>
          <div className="ml-auto flex items-center gap-1">
            <Button variant="ghost" size="icon" onClick={toggleScheme} aria-label="Toggle theme">
              {scheme === 'dark' ? <Sun /> : <Moon />}
            </Button>
            <span className="hidden px-2 text-sm text-muted-foreground sm:inline">
              {session?.display_name}
            </span>
            <Button variant="ghost" size="icon" onClick={() => void signOut()} aria-label="Sign out">
              <LogOut />
            </Button>
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

function Sidebar({ entries, className }: { entries: NavEntry[]; className?: string }) {
  const { pathname } = useLocation()
  return (
    <aside
      className={cn(
        'w-60 shrink-0 flex-col gap-1 border-r border-border bg-sidebar p-3 text-sidebar-foreground',
        className,
      )}
    >
      {entries.map((e) =>
        e.kind === 'leaf' ? (
          <NavItem key={e.to} to={e.to} label={e.label} icon={e.icon} active={pathname === e.to} />
        ) : (
          <div key={e.label} className="mt-2">
            <p className="px-3 py-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
              {e.label}
            </p>
            {e.children.map((c) => (
              <NavItem
                key={c.to}
                to={c.to}
                label={c.label}
                icon={c.icon}
                active={pathname === c.to || pathname.startsWith(c.to + '/')}
              />
            ))}
          </div>
        ),
      )}
    </aside>
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
        active ? 'bg-sidebar-accent text-foreground' : 'text-muted-foreground hover:bg-sidebar-accent',
      )}
    >
      {Icon && <Icon className="size-4" />}
      {label}
    </Link>
  )
}
