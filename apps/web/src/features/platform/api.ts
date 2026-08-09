import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { z, platformStudioList, platformUsage, type PlatformPlanAction } from '@ipc/contracts'
import { toast } from 'sonner'
import { callApi } from '@/shared/api/client'
import { useAuth } from '@/shared/auth/AuthProvider'

const ok = z.object({ ok: z.boolean() })

/** Cross-tenant vendor console reads. Gated on the platform_admins allowlist. */
export function usePlatformStudios() {
  const { session } = useAuth()
  return useQuery({
    queryKey: ['platform', 'studios'],
    queryFn: () => callApi('/platform/studios', { responseSchema: platformStudioList }),
    enabled: !!session?.is_platform_admin,
    staleTime: 30_000,
  })
}

export function usePlatformUsage() {
  const { session } = useAuth()
  return useQuery({
    queryKey: ['platform', 'usage'],
    queryFn: () => callApi('/platform/usage', { responseSchema: platformUsage }),
    enabled: !!session?.is_platform_admin,
    staleTime: 30_000,
  })
}

const ACTION_MSG: Record<PlatformPlanAction['action'], string> = {
  extend: 'Plan extended',
  expire: 'Plan expired',
  trial: 'Trial granted',
}

/** Vendor plan action on one tenant (extend / expire / grant trial). */
export function usePlatformPlanAction() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ studioId, ...body }: PlatformPlanAction & { studioId: string }) =>
      callApi(`/platform/studios/${studioId}/plan`, { method: 'POST', body, responseSchema: ok }),
    onSuccess: (_data, vars) => {
      toast.success(ACTION_MSG[vars.action])
      void qc.invalidateQueries({ queryKey: ['platform'] })
    },
  })
}
