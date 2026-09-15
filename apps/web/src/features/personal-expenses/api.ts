import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import {
  personalExpenseList,
  personalExpenseReport,
  z,
  type CreatePersonalExpenseRequest,
} from '@ipc/contracts'
import { callApi } from '@/shared/api/client'
import { useAuth } from '@/shared/auth/AuthProvider'
import { useAccess } from '@/shared/auth/useAccess'

const created = z.object({ id: z.string().uuid() })
/** Mutation responses whose body the UI discards; unknown keeps `any` out of the app. */
const anySchema = z.unknown()

export interface PersonalExpenseFilters {
  search?: string | undefined
  category?: string | undefined
  party_id?: string | undefined
  date_from?: string | undefined
  date_to?: string | undefined
  min_amount?: string | undefined
  max_amount?: string | undefined
  gst_treatment?: string | undefined
  reverse_charge?: string | undefined
}

export function usePersonalExpenses(filters: PersonalExpenseFilters) {
  const { session } = useAuth()
  const access = useAccess()
  const base = new URLSearchParams()
  if (filters.search?.trim()) base.set('search', filters.search.trim())
  if (filters.category) base.set('category', filters.category)
  if (filters.party_id) base.set('party_id', filters.party_id)
  if (filters.date_from) base.set('date_from', filters.date_from)
  if (filters.date_to) base.set('date_to', filters.date_to)
  if (filters.min_amount) base.set('min_amount', filters.min_amount)
  if (filters.max_amount) base.set('max_amount', filters.max_amount)
  if (filters.gst_treatment) base.set('gst_treatment', filters.gst_treatment)
  if (filters.reverse_charge) base.set('reverse_charge', filters.reverse_charge)
  const qs = base.toString()
  return useInfiniteQuery({
    queryKey: ['personal-expenses', qs],
    queryFn: ({ pageParam }) => {
      const params = new URLSearchParams(qs)
      if (pageParam) params.set('cursor', pageParam)
      const suffix = params.toString()
      return callApi(`/personal-expenses${suffix ? `?${suffix}` : ''}`, { responseSchema: personalExpenseList })
    },
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.next_cursor ?? undefined,
    enabled: !!session && access.hasModule('personal_expenses'),
    staleTime: 15_000,
  })
}

export function usePersonalExpenseReport(startDate: string, endDate: string) {
  const { session } = useAuth()
  const access = useAccess()
  return useQuery({
    queryKey: ['personal-expenses', 'report', startDate, endDate],
    queryFn: () =>
      callApi(`/personal-expenses/report?start_date=${startDate}&end_date=${endDate}`, {
        responseSchema: personalExpenseReport,
      }),
    enabled: !!session && access.hasModule('personal_expenses') && !!startDate && !!endDate,
    staleTime: 30_000,
  })
}

function usePersonalExpenseMutation<TArgs, TResult>(fn: (a: TArgs) => Promise<TResult>, message: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: fn,
    onSuccess: () => {
      toast.success(message)
      void qc.invalidateQueries({ queryKey: ['personal-expenses'] })
    },
  })
}

export function useSavePersonalExpense() {
  return usePersonalExpenseMutation(
    ({ id, body }: { id?: string | undefined; body: CreatePersonalExpenseRequest }) =>
      callApi(id ? `/personal-expenses/${id}` : '/personal-expenses', {
        method: id ? 'PATCH' : 'POST',
        body,
        responseSchema: id ? anySchema : created,
      }),
    'Expense saved',
  )
}

export function useDeletePersonalExpense() {
  return usePersonalExpenseMutation(
    (id: string) => callApi(`/personal-expenses/${id}`, { method: 'DELETE', responseSchema: anySchema }),
    'Expense deleted',
  )
}

const attachmentSchema = z.object({
  id: z.string(),
  file_name: z.string().nullable().optional(),
  file_url: z.string().nullable().optional(),
  file_size: z.number().nullable().optional(),
  mime_type: z.string().nullable().optional(),
  created_at: z.string().nullable().optional(),
})

/** Lovable parity: expense detail + attachments stub (list/add/remove). */
export function usePersonalExpenseDetail(id: string | null) {
  const { session } = useAuth()
  const access = useAccess()
  return useQuery({
    queryKey: ['personal-expenses', 'detail', id],
    queryFn: () => callApi(`/personal-expenses/${id}`, { responseSchema: anySchema }),
    enabled: !!session && access.hasModule('personal_expenses') && !!id,
    staleTime: 15_000,
  })
}

export function usePersonalExpenseAttachments(id: string | null) {
  const { session } = useAuth()
  const access = useAccess()
  return useQuery({
    queryKey: ['personal-expenses', 'attachments', id],
    queryFn: () => callApi(`/personal-expenses/${id}/attachments`, { responseSchema: attachmentSchema.array() }),
    enabled: !!session && access.hasModule('personal_expenses') && !!id,
    staleTime: 15_000,
  })
}

export function useAddPersonalExpenseAttachment() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, file_name, file_url }: { id: string; file_name: string; file_url: string }) =>
      callApi(`/personal-expenses/${id}/attachments`, { method: 'POST', body: { file_name, file_url }, responseSchema: anySchema }),
    onSuccess: () => {
      toast.success('Attachment added')
      void qc.invalidateQueries({ queryKey: ['personal-expenses', 'attachments'] })
    },
  })
}

export function useDeletePersonalExpenseAttachment() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (attachmentId: string) =>
      callApi(`/personal-expenses/attachments/${attachmentId}`, { method: 'DELETE', responseSchema: anySchema }),
    onSuccess: () => {
      toast.success('Attachment removed')
      void qc.invalidateQueries({ queryKey: ['personal-expenses', 'attachments'] })
    },
  })
}
