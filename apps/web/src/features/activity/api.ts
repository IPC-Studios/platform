/* eslint-disable @typescript-eslint/no-unused-vars */
import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { z } from '@ipc/contracts'
import { callApi } from '@/shared/api/client'
import { useAuth } from '@/shared/auth/AuthProvider'

const activityItemSchema = z.object({
  id: z.string().uuid(),
  user_id: z.string().uuid(),
  user_name: z.string().nullable(),
  action: z.string(),
  entity_type: z.string(),
  entity_id: z.string().uuid().nullable(),
  metadata: z.any().nullable(),
  created_at: z.string(),
})

const activityPageSchema = z.object({
  items: activityItemSchema.array(),
  next_cursor: z.string().nullable(),
})

export type ActivityItem = z.infer<typeof activityItemSchema>

export function useActivityLog(filters?: { entity_type?: string; user_id?: string }) {
  const { session } = useAuth()
  return useInfiniteQuery({
    queryKey: ['activity', filters?.entity_type ?? 'all', filters?.user_id ?? 'all'],
    queryFn: ({ pageParam }) => {
      const params = new URLSearchParams({ limit: '50' })
      if (pageParam) params.set('cursor', pageParam as string)
      if (filters?.entity_type) params.set('entity_type', filters.entity_type)
      if (filters?.user_id) params.set('user_id', filters.user_id)
      return callApi(`/activity?${params.toString()}`, { responseSchema: activityPageSchema })
    },
    initialPageParam: '' as string,
    getNextPageParam: (last) => last.next_cursor ?? undefined,
    enabled: !!session,
    staleTime: 15_000,
  })
}

export function useLogActivity() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: {
      action: string
      entity_type: string
      entity_id?: string
      metadata?: Record<string, unknown>
    }) =>
      callApi('/activity', {
        method: 'POST',
        body,
        responseSchema: z.object({ id: z.string().uuid() }),
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['activity'] })
    },
  })
}
