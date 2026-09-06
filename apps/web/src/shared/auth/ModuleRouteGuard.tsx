import type { ReactNode } from 'react'
import { Link } from '@tanstack/react-router'
import type { ModuleKey } from '@ipc/permissions'
import { useAccess } from './useAccess'
import { Button } from '../ui/button'
import { EmptyState } from '../ui/states'

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
        <EmptyState
          title="Not available"
          description="You don’t have access to this area. Ask the studio owner if you think you should."
          action={
            <Button variant="outline" asChild>
              <Link to="/dashboard">Back to dashboard</Link>
            </Button>
          }
        />
      )
    )
  }
  return <>{children}</>
}
