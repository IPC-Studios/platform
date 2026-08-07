import { useMemo } from 'react'
import { accessFromSet } from '@ipc/permissions'
import { useAuth } from './AuthProvider'

/**
 * The single access hook. Gates sidebar, route guards, and action buttons off
 * the effective permission set the server already composed. Never re-derives
 * permissions on the client — same registry, one resolution.
 */
export function useAccess() {
  const { session } = useAuth()
  return useMemo(
    () => accessFromSet(session?.permissions ?? [], session?.is_owner ?? false),
    [session],
  )
}
