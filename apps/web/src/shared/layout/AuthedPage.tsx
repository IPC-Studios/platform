import type { ReactNode } from 'react'
import type { ModuleKey } from '@ipc/permissions'
import { ModuleRouteGuard } from '../auth/ModuleRouteGuard'

/**
 * A page's module gate.
 *
 * The session check and the shell live on the layout route now (see
 * app/router.tsx), so this is only the per-page permission check — which
 * genuinely differs per route and therefore belongs with the route.
 *
 * Keeping the shell out here is the point: it used to be rebuilt on every
 * navigation, which reset any state it held and re-ran every mount effect.
 */
export function AuthedPage({ module, children }: { module: ModuleKey; children: ReactNode }) {
  return <ModuleRouteGuard module={module}>{children}</ModuleRouteGuard>
}
