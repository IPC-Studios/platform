import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { expense, projectFinancials, z, type CreateExpenseRequest, type UpdateExpenseRequest } from '@ipc/contracts'

const noContent = z.unknown()
import { toast } from 'sonner'
import { callApi } from '@/shared/api/client'
import { useAuth } from '@/shared/auth/AuthProvider'
import { useAccess } from '@/shared/auth/useAccess'

const expenses = expense.array()
const financials = projectFinancials.array()

export function useExpenses() {
  const { session } = useAuth()
  const access = useAccess()
  return useQuery({
    queryKey: ['expenses'],
    queryFn: () => callApi('/financials/expenses', { responseSchema: expenses }),
    enabled: !!session && access.hasModule('company_expenses'),
    staleTime: 15_000,
  })
}

export function useCreateExpense() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: CreateExpenseRequest) =>
      callApi('/financials/expenses', { method: 'POST', body: input, responseSchema: expense }),
    onSuccess: () => {
      toast.success('Expense added')
      void qc.invalidateQueries({ queryKey: ['expenses'] })
    },
  })
}

export function useUpdateExpense() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: UpdateExpenseRequest }) =>
      callApi(`/financials/expenses/${id}`, { method: 'PATCH', body: patch, responseSchema: expense }),
    onSuccess: () => {
      toast.success('Expense updated')
      void qc.invalidateQueries({ queryKey: ['expenses'] })
    },
  })
}

export function useDeleteExpense() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => callApi(`/financials/expenses/${id}`, { method: 'DELETE', responseSchema: noContent }),
    onSuccess: () => {
      toast.success('Expense deleted')
      void qc.invalidateQueries({ queryKey: ['expenses'] })
    },
  })
}

export function useProjectFinancials() {
  const { session } = useAuth()
  const access = useAccess()
  return useQuery({
    queryKey: ['financials', 'projects'],
    queryFn: () => callApi('/financials/projects', { responseSchema: financials }),
    enabled: !!session && access.hasModule('financials'),
    staleTime: 30_000,
  })
}
