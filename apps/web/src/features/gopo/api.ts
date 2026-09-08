import { useQuery } from '@tanstack/react-query'
import { gopoSummary } from '@ipc/contracts'
import { callApi } from '@/shared/api/client'
import { useAuth } from '@/shared/auth/AuthProvider'
import { useAccess } from '@/shared/auth/useAccess'

export function useGopoSummary() {
  const { session } = useAuth()
  const access = useAccess()
  return useQuery({
    queryKey: ['financials', 'gopo'],
    queryFn: () => callApi('/financials/gopo', { responseSchema: gopoSummary }),
    enabled: !!session && access.hasModule('financials'),
    staleTime: 60_000,
  })
}
