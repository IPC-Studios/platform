import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import {
  createLeadRequest,
  crmLead,
  distributionRule,
  updateLeadRequest,
  z,
  type CreateLeadRequest,
  type UpdateLeadRequest,
} from '@ipc/contracts'
import { callApi } from '@/shared/api/client'
import { useAuth } from '@/shared/auth/AuthProvider'
import { useAccess } from '@/shared/auth/useAccess'

const leadsList = crmLead.array()
const rulesList = distributionRule.array()
const noContent = z.any()

export function useLeads() {
  const { session } = useAuth()
  const access = useAccess()
  return useQuery({
    queryKey: ['crm', 'leads'],
    queryFn: () => callApi('/crm/leads', { responseSchema: leadsList }),
    enabled: !!session && access.hasModule('crm'),
    staleTime: 15_000,
  })
}

export function useDistribution() {
  const { session } = useAuth()
  const access = useAccess()
  return useQuery({
    queryKey: ['crm', 'distribution'],
    queryFn: () => callApi('/crm/distribution', { responseSchema: rulesList }),
    enabled: !!session && access.hasModule('crm'),
    staleTime: 60_000,
  })
}

function useCrmMutation<TInput, TOutput>(
  fn: (input: TInput) => Promise<TOutput>,
  success?: string,
) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: fn,
    onSuccess: () => {
      if (success) toast.success(success)
      void qc.invalidateQueries({ queryKey: ['crm'] })
    },
    onError: (e: Error) => toast.error(e.message),
  })
}

export function useAddLead() {
  return useCrmMutation(
    (input: CreateLeadRequest) =>
      callApi('/crm/leads', {
        method: 'POST',
        body: createLeadRequest.parse(input),
        responseSchema: crmLead,
      }),
    'Lead added',
  )
}

/**
 * One mutation for every field on a lead. Stage moves, the hot flag and the
 * next follow-up all go through the same PATCH, so the server stays the only
 * place that decides what a stage change timestamps.
 */
export function useUpdateLead(success?: string) {
  return useCrmMutation(
    ({ id, patch }: { id: string; patch: UpdateLeadRequest }) =>
      callApi(`/crm/leads/${id}`, {
        method: 'PATCH',
        body: updateLeadRequest.parse(patch),
        responseSchema: noContent,
      }),
    success,
  )
}
