import { useQuery } from '@tanstack/react-query'
import { notification } from '@ipc/contracts'
import { callApi } from '@/shared/api/client'
import { useAuth } from '@/shared/auth/AuthProvider'

const list = notification.array()

/**
 * One cache entry behind both readers of this list: the header bell, which is
 * mounted on every screen, and the Alerts page. Sharing the key means opening
 * Alerts costs no request when the bell has already fetched, and marking one
 * read updates the badge without a second round trip.
 */
export function useNotifications() {
  const { session } = useAuth()
  return useQuery({
    queryKey: ['notifications'],
    queryFn: () => callApi('/notifications', { responseSchema: list }),
    enabled: !!session,
    staleTime: 15_000,
  })
}

export const unreadCount = (rows: { read_at?: string | null }[] | undefined) =>
  (rows ?? []).filter((n) => !n.read_at).length
