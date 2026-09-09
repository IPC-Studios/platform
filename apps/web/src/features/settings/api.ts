import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import {
  auditLogPage,
  authToken,
  cronRun,
  healthBody,
  z,
  type ChangePasswordRequest,
} from '@ipc/contracts'
import { callApi } from '@/shared/api/client'
import { config } from '@/shared/config'
import { useAuth } from '@/shared/auth/AuthProvider'
import { setTokens } from '@/shared/auth/token'
import { markCookieSession } from '@/shared/api/client'

/** Store the pair; an empty refresh token means the API keeps it in its cookie. */
function rememberSession(pair: { access_token: string; refresh_token: string }) {
  setTokens(pair)
  markCookieSession(!pair.refresh_token)
}

/** The studio's audit trail, newest first, a page at a time. Owner only. */
export function useAuditLog(entityType?: string) {
  const { session } = useAuth()
  return useInfiniteQuery({
    queryKey: ['settings', 'audit', entityType ?? 'all'],
    queryFn: ({ pageParam }) => {
      const params = new URLSearchParams({ limit: '50' })
      if (pageParam) params.set('cursor', pageParam)
      if (entityType) params.set('entity_type', entityType)
      return callApi(`/settings/audit?${params.toString()}`, { responseSchema: auditLogPage })
    },
    initialPageParam: '' as string,
    getNextPageParam: (last) => last.next_cursor ?? undefined,
    enabled: !!session?.is_owner,
    staleTime: 15_000,
  })
}

/** Scheduled job history. Owner or platform admin. */
export function useCronRuns() {
  const { session } = useAuth()
  return useQuery({
    queryKey: ['settings', 'cron_runs'],
    queryFn: () => callApi('/cron/runs?limit=50', { responseSchema: cronRun.array() }),
    enabled: !!session && (session.is_owner || session.is_platform_admin),
    staleTime: 30_000,
  })
}

/**
 * The public liveness probe. Fetched directly rather than through callApi so a
 * 503 (database unreachable) still yields the body instead of an exception.
 */
export function useHealth() {
  return useQuery({
    queryKey: ['health'],
    queryFn: async () => {
      const res = await fetch(`${config.apiBaseUrl}/health`)
      return healthBody.parse(await res.json())
    },
    staleTime: 15_000,
    retry: false,
  })
}

/** Change the password from inside a session; the fresh pair replaces the stored one. */
export function useChangePassword() {
  const { refresh } = useAuth()
  return useMutation({
    mutationFn: async (input: ChangePasswordRequest) => {
      const pair = await callApi('/auth/change-password', {
        method: 'POST',
        body: input,
        responseSchema: authToken,
      })
      rememberSession(pair)
      await refresh()
    },
  })
}

// ── Custom Lookups ──────────────────────────────────────────
const lookupSchema = z.object({
  id: z.string().uuid(),
  category: z.string(),
  value: z.string(),
  sort_order: z.number().int(),
  is_active: z.boolean(),
})
const lookupArraySchema = lookupSchema.array()

export function useCustomLookups(category?: string) {
  const { session } = useAuth()
  return useQuery({
    queryKey: ['settings', 'lookups', category ?? 'all'],
    queryFn: () => {
      const params = category ? `?category=${encodeURIComponent(category)}` : ''
      return callApi(`/settings/lookups${params}`, { responseSchema: lookupArraySchema })
    },
    enabled: !!session?.is_owner,
    staleTime: 30_000,
  })
}

const activeLookupSchema = z.object({
  id: z.string().uuid(),
  category: z.string(),
  value: z.string(),
  sort_order: z.number().int(),
})
const activeLookupArraySchema = activeLookupSchema.array()

/** The active values of one lookup category — open to any signed-in member, not just the owner. */
export function useActiveLookups(category: string) {
  const { session } = useAuth()
  return useQuery({
    queryKey: ['settings', 'lookups', 'active', category],
    queryFn: () => callApi(`/settings/lookups/active?category=${encodeURIComponent(category)}`, { responseSchema: activeLookupArraySchema }),
    enabled: !!session,
    staleTime: 30_000,
  })
}

export function useCreateCustomLookup() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: { category: string; value: string; sort_order?: number }) =>
      callApi('/settings/lookups', {
        method: 'POST',
        body,
        responseSchema: z.object({ id: z.string().uuid() }),
      }),
    onSuccess: () => {
      toast.success('Lookup created')
      void qc.invalidateQueries({ queryKey: ['settings', 'lookups'] })
    },
  })
}

export function useUpdateCustomLookup() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: { value?: string; sort_order?: number; is_active?: boolean } }) =>
      callApi(`/settings/lookups/${id}`, {
        method: 'PATCH',
        body: patch,
        responseSchema: z.object({ ok: z.boolean() }),
      }),
    onSuccess: () => {
      toast.success('Lookup updated')
      void qc.invalidateQueries({ queryKey: ['settings', 'lookups'] })
    },
  })
}

export function useDeleteCustomLookup() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) =>
      callApi(`/settings/lookups/${id}`, {
        method: 'DELETE',
        responseSchema: z.unknown(),
      }),
    onSuccess: () => {
      toast.success('Lookup deleted')
      void qc.invalidateQueries({ queryKey: ['settings', 'lookups'] })
    },
  })
}
