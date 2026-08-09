import type { ReactNode } from 'react'
import { RequireAuth } from '../auth/guards'
import { useAuth } from '../auth/AuthProvider'
import { AppShell } from './AppShell'

/**
 * Cross-tenant vendor console shell. Gates on the platform_admins allowlist
 * (session.is_platform_admin), NOT a tenant module — a studio owner must never
 * reach it. The API enforces the same allowlist again server-side.
 */
export function PlatformPage({ children }: { children: ReactNode }) {
  return (
    <RequireAuth>
      <AppShell>
        <PlatformGuard>{children}</PlatformGuard>
      </AppShell>
    </RequireAuth>
  )
}

function PlatformGuard({ children }: { children: ReactNode }) {
  const { session } = useAuth()
  if (!session?.is_platform_admin) {
    return (
      <div style={{ fontFamily: 'system-ui', padding: 24 }}>
        <h2>Not available</h2>
        <p>You don’t have access to this area.</p>
      </div>
    )
  }
  return <>{children}</>
}
