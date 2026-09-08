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
const anySchema = z.any()

export function usePersonalExpenses(filters: { search?: string; category?: string }) {
  const { session } = useAuth()
  const access = useAccess()
  const base = new URLSearchParams()
  if (filters.search?.trim()) base.set('search', filters.search.trim())
  if (filters.category) base.set('category', filters.category)
  const qs = base.toString()
  return useInfiniteQuery({
    queryKey: ['personal-expenses', filters.search ?? '', filters.category ?? 'all'],
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
    ({ id, body }: { id?: string; body: CreatePersonalExpenseRequest }) =>
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
