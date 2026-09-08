import { useQuery } from '@tanstack/react-query'
import { gstAnalysis } from '@ipc/contracts'
import { callApi } from '@/shared/api/client'
import { useAuth } from '@/shared/auth/AuthProvider'
import { useAccess } from '@/shared/auth/useAccess'

export function useGstAnalysis(startDate: string, endDate: string) {
  const { session } = useAuth()
  const access = useAccess()
  return useQuery({
    queryKey: ['financials', 'gst-analysis', startDate, endDate],
    queryFn: () =>
      callApi(`/financials/gst-analysis?start_date=${startDate}&end_date=${endDate}`, {
        responseSchema: gstAnalysis,
      }),
    enabled: !!session && access.hasModule('financials') && !!startDate && !!endDate,
    staleTime: 30_000,
  })
}
