import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import {
  teamPayoutList,
  z,
  type CreateTeamPayoutRequest,
} from '@ipc/contracts'
import { callApi } from '@/shared/api/client'
import { useAuth } from '@/shared/auth/AuthProvider'
import { useAccess } from '@/shared/auth/useAccess'

const created = z.object({ id: z.string().uuid() })
const anySchema = z.any()

export function useTeamPayouts(filters?: { user_id?: string; status?: string }) {
  const { session } = useAuth()
  const access = useAccess()
  const params = new URLSearchParams()
  if (filters?.user_id) params.set('user_id', filters.user_id)
  if (filters?.status) params.set('status', filters.status)
  const qs = params.toString()

  return useQuery({
    queryKey: ['team-payouts', filters?.user_id ?? '', filters?.status ?? 'all'],
    queryFn: () => callApi(`/team-payouts${qs ? `?${qs}` : ''}`, { responseSchema: teamPayoutList }),
    enabled: !!session && access.hasModule('team_payouts'),
    staleTime: 15_000,
  })
}

function useTeamPayoutMutation<TArgs, TResult>(fn: (a: TArgs) => Promise<TResult>, message: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: fn,
    onSuccess: () => {
      toast.success(message)
      void qc.invalidateQueries({ queryKey: ['team-payouts'] })
    },
  })
}

export function useCreateTeamPayout() {
  return useTeamPayoutMutation(
    (body: CreateTeamPayoutRequest) =>
      callApi('/team-payouts', { method: 'POST', body, responseSchema: created }),
    'Payout created',
  )
}

export function useUpdatePayoutStatus() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) =>
      callApi(`/team-payouts/${id}/status`, {
        method: 'PATCH',
        body: { status },
        responseSchema: anySchema,
      }),
    onSuccess: () => {
      toast.success('Status updated')
      void qc.invalidateQueries({ queryKey: ['team-payouts'] })
    },
  })
}

export function useDeleteTeamPayout() {
  return useTeamPayoutMutation(
    (id: string) => callApi(`/team-payouts/${id}`, { method: 'DELETE', responseSchema: anySchema }),
    'Payout deleted',
  )
}
