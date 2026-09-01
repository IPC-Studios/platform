import { Link, useLocation } from '@tanstack/react-router'
import type { ModuleKey } from '@ipc/permissions'
import { useAccess } from '@/shared/auth/useAccess'
import { cn } from '@/shared/ui/cn'

const TABS: ReadonlyArray<{ to: string; label: string; module: ModuleKey }> = [
  { to: '/settings/company', label: 'Company', module: 'settings' },
  { to: '/settings/appearance', label: 'Theme & Branding', module: 'settings' },
  { to: '/settings/subscription', label: 'Subscription', module: 'settings_subscription' },
]

/**
 * The settings pages are separate routes rather than one long page, so they
 * need something to say they belong together. Links, not state: each tab is a
 * real destination that survives a refresh and can be sent to someone.
 */
export function SettingsTabs() {
  const { pathname } = useLocation()
  const access = useAccess()
  const visible = TABS.filter((t) => access.hasModule(t.module))
  if (visible.length < 2) return null

  return (
    <div className="mb-6 flex gap-1 rounded-xl border border-border bg-card p-1.5">
      {visible.map((t) => (
        <Link
          key={t.to}
          to={t.to}
          className={cn(
            'rounded-lg px-4 py-2 text-sm font-medium transition-colors',
            pathname === t.to
              ? 'bg-primary text-primary-foreground'
              : 'text-muted-foreground hover:bg-accent hover:text-foreground',
          )}
        >
          {t.label}
        </Link>
      ))}
    </div>
  )
}
