import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import {
  referralCampaignList,
  referralSubmissionList,
  z,
  type CreateReferralCampaignRequest,
  type ReferralCampaignStatus,
} from '@ipc/contracts'
import { callApi } from '@/shared/api/client'
import { useAuth } from '@/shared/auth/AuthProvider'
import { useAccess } from '@/shared/auth/useAccess'

const created = z.object({ id: z.string().uuid() })
/** Mutation responses whose body the UI discards; unknown keeps `any` out of the app. */
const anySchema = z.unknown()

export function useReferralCampaigns() {
  const { session } = useAuth()
  const access = useAccess()
  return useQuery({
    queryKey: ['referrals', 'campaigns'],
    queryFn: () => callApi('/referrals/campaigns', { responseSchema: referralCampaignList }),
    enabled: !!session && access.hasModule('referrals'),
    staleTime: 15_000,
  })
}

export function useReferralSubmissions(campaignId?: string) {
  const { session } = useAuth()
  const access = useAccess()
  const base = new URLSearchParams()
  if (campaignId) base.set('campaign_id', campaignId)
  const qs = base.toString()

  return useInfiniteQuery({
    queryKey: ['referrals', 'submissions', campaignId ?? 'all'],
    queryFn: ({ pageParam }) => {
      const params = new URLSearchParams(qs)
      if (pageParam) params.set('cursor', pageParam)
      const suffix = params.toString()
      return callApi(`/referrals/submissions${suffix ? `?${suffix}` : ''}`, { responseSchema: referralSubmissionList })
    },
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.next_cursor ?? undefined,
    enabled: !!session && access.hasModule('referrals'),
    staleTime: 15_000,
  })
}

function useReferralMutation<TArgs, TResult>(fn: (a: TArgs) => Promise<TResult>, message: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: fn,
    onSuccess: () => {
      toast.success(message)
      void qc.invalidateQueries({ queryKey: ['referrals'] })
    },
  })
}

export function useSaveReferralCampaign() {
  return useReferralMutation(
    ({ id, body }: { id?: string | undefined; body: CreateReferralCampaignRequest }) =>
      callApi(id ? `/referrals/${id}` : '/referrals/campaigns', {
        method: id ? 'PATCH' : 'POST',
        body,
        responseSchema: id ? anySchema : created,
      }),
    'Campaign saved',
  )
}

export function useUpdateReferralCampaignStatus() {
  return useReferralMutation(
    ({ id, status }: { id: string; status: ReferralCampaignStatus }) =>
      callApi(`/referrals/${id}/status`, { method: 'PATCH', body: { status }, responseSchema: anySchema }),
    'Campaign status updated',
  )
}

export function useDeleteReferralCampaign() {
  return useReferralMutation(
    (id: string) => callApi(`/referrals/${id}`, { method: 'DELETE', responseSchema: anySchema }),
    'Campaign deleted',
  )
}

export function useUpdateSubmissionStatus() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) =>
      callApi(`/referrals/submissions/${id}/status`, {
        method: 'PATCH',
        body: { status },
        responseSchema: anySchema,
      }),
    onSuccess: () => {
      toast.success('Status updated')
      void qc.invalidateQueries({ queryKey: ['referrals'] })
    },
  })
}
