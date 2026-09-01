import type { ReactNode } from 'react'
import { useAuth } from '../auth/AuthProvider'

/**
 * Cross-tenant vendor console gate. Checks the platform_admins allowlist
 * (session.is_platform_admin), NOT a tenant module — a studio owner must never
 * reach it. The API enforces the same allowlist again server-side.
 *
 * The session check and shell come from the layout route; this is only the
 * allowlist.
 */
export function PlatformPage({ children }: { children: ReactNode }) {
  const { session } = useAuth()
  if (!session?.is_platform_admin) {
    return (
      <div className="py-16 text-center">
        <h2 className="font-semibold">Not available</h2>
        <p className="mt-1 text-sm text-muted-foreground">You don’t have access to this area.</p>
      </div>
    )
  }
  return <>{children}</>
}
