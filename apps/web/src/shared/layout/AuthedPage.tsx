import type { ReactNode } from 'react'
import type { ModuleKey } from '@ipc/permissions'
import { RequireAuth } from '../auth/guards'
import { ModuleRouteGuard } from '../auth/ModuleRouteGuard'
import { AppShell } from './AppShell'

/** Standard authed screen: session gate → shell → module gate. */
export function AuthedPage({
  module,
  children,
  allowExpired = false,
}: {
  module: ModuleKey
  children: ReactNode
  allowExpired?: boolean
}) {
  return (
    <RequireAuth allowExpired={allowExpired}>
      <AppShell>
        <ModuleRouteGuard module={module}>{children}</ModuleRouteGuard>
      </AppShell>
    </RequireAuth>
  )
}
