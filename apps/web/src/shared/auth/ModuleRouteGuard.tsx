import type { ReactNode } from 'react'
import type { ModuleKey } from '@ipc/permissions'
import { useAccess } from './useAccess'

/**
 * Gate a route/section on module visibility, using the same effective set the
 * server composed. Renders a fallback (default: a simple denial) when hidden.
 * Direct-URL access to a guarded module is refused here on the client; the API
 * enforces it again server-side.
 */
export function ModuleRouteGuard({
  module,
  children,
  fallback,
}: {
  module: ModuleKey
  children: ReactNode
  fallback?: ReactNode
}) {
  const access = useAccess()
  if (!access.hasModule(module)) {
    return (
      fallback ?? (
        <div style={{ fontFamily: 'system-ui', padding: 24 }}>
          <h2>Not available</h2>
          <p>You don’t have access to this area.</p>
        </div>
      )
    )
  }
  return <>{children}</>
}
