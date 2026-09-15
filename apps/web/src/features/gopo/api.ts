import { useQuery } from '@tanstack/react-query'
import { gopoSummary } from '@ipc/contracts'
import { callApi } from '@/shared/api/client'
import { useAuth } from '@/shared/auth/AuthProvider'
import { useAccess } from '@/shared/auth/useAccess'

export function useGopoSummary(filters?: { start_date?: string | undefined; end_date?: string | undefined; include_salaries?: boolean | undefined }) {
  const { session } = useAuth()
  const access = useAccess()
  const params = new URLSearchParams()
  if (filters?.start_date) params.set('start_date', filters.start_date)
  if (filters?.end_date) params.set('end_date', filters.end_date)
  if (filters?.include_salaries === false) params.set('include_salaries', 'false')
  const qs = params.toString()
  return useQuery({
    queryKey: ['financials', 'gopo', qs],
    queryFn: () => callApi(`/financials/gopo${qs ? `?${qs}` : ''}`, { responseSchema: gopoSummary }),
    enabled: !!session && access.hasModule('financials'),
    staleTime: 60_000,
  })
}
