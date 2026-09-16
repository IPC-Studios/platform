import type { ReactNode } from 'react'
import { Link } from '@tanstack/react-router'
import type { ModuleKey } from '@ipc/permissions'
import { useAccess } from './useAccess'
import { useAuth } from './AuthProvider'
import { Button } from '../ui/button'
import { SkeletonCards } from '../ui/skeleton'
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
  const { loading } = useAuth()
  const access = useAccess()
  // Permissions come from the session, and until it lands `access` is the
  // empty set -- so every guarded route answered "Not available" first and
  // corrected itself a moment later. On a slow connection that is the only
  // thing someone sees, and it reads as having been locked out of their own
  // studio. Absence of an answer is not a denial.
  if (loading) return <SkeletonCards count={3} />
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
