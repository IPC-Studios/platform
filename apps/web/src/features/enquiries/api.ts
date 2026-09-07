import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import {
  convertEnquiryResponse,
  enquiryList,
  z,
  type EnquiryStatus,
  type SaveEnquiryRequest,
} from '@ipc/contracts'
import { callApi } from '@/shared/api/client'
import { useAuth } from '@/shared/auth/AuthProvider'
import { useAccess } from '@/shared/auth/useAccess'

const created = z.object({ id: z.string().uuid() })
const anySchema = z.any()

export function useEnquiries(filters: { status?: EnquiryStatus | null; search?: string }) {
  const { session } = useAuth()
  const access = useAccess()
  const query = new URLSearchParams()
  if (filters.status) query.set('status', filters.status)
  if (filters.search?.trim()) query.set('search', filters.search.trim())
  const qs = query.toString()
  return useQuery({
    queryKey: ['enquiries', filters.status ?? 'all', filters.search ?? ''],
    queryFn: () => callApi(`/enquiries${qs ? `?${qs}` : ''}`, { responseSchema: enquiryList }),
    enabled: !!session && access.hasModule('crm'),
    staleTime: 15_000,
  })
}

function useEnquiryMutation<TArgs, TResult>(fn: (a: TArgs) => Promise<TResult>, message: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: fn,
    onSuccess: () => {
      toast.success(message)
      void qc.invalidateQueries({ queryKey: ['enquiries'] })
    },
  })
}

export function useSaveEnquiry() {
  return useEnquiryMutation(
    ({ id, body }: { id?: string; body: SaveEnquiryRequest }) =>
      callApi(id ? `/enquiries/${id}` : '/enquiries', {
        method: id ? 'PATCH' : 'POST',
        body,
        responseSchema: id ? anySchema : created,
      }),
    'Enquiry saved',
  )
}

export function useDeleteEnquiry() {
  return useEnquiryMutation(
    (id: string) => callApi(`/enquiries/${id}`, { method: 'DELETE', responseSchema: anySchema }),
    'Enquiry deleted',
  )
}

/** Also invalidates leads: the conversion just added one. */
export function useConvertEnquiry() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, notes }: { id: string; notes?: string | null }) =>
      callApi(`/enquiries/${id}/convert`, {
        method: 'POST',
        body: { notes: notes ?? null },
        responseSchema: convertEnquiryResponse,
      }),
    onSuccess: () => {
      toast.success('Converted to a lead')
      void qc.invalidateQueries({ queryKey: ['enquiries'] })
      void qc.invalidateQueries({ queryKey: ['crm'] })
    },
  })
}
