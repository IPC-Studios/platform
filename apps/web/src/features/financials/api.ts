import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { expense, projectFinancials, type CreateExpenseRequest } from '@ipc/contracts'
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
