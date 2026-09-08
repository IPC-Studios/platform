import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { party, type CreatePartyRequest } from '@ipc/contracts'
import { callApi } from '@/shared/api/client'
import { useAuth } from '@/shared/auth/AuthProvider'

/** Vendors, freelancers, and other parties an expense is paid to or received from. */
export function useParties() {
  const { session } = useAuth()
  return useQuery({
    queryKey: ['parties'],
    queryFn: () => callApi('/parties', { responseSchema: party.array() }),
    enabled: !!session,
    staleTime: 60_000,
  })
}

export function useCreateParty() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: CreatePartyRequest) => callApi('/parties', { method: 'POST', body: input, responseSchema: party }),
    onSuccess: () => {
      toast.success('Party added')
      void qc.invalidateQueries({ queryKey: ['parties'] })
    },
  })
}
