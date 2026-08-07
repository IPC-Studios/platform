import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { z } from '@ipc/contracts'
import {
  taskListItem,
  type SetBoardOrderRequest,
  type TaskStatus,
} from '@ipc/contracts'
import { callApi } from '@/shared/api/client'
import { useAuth } from '@/shared/auth/AuthProvider'
import { useAccess } from '@/shared/auth/useAccess'

const board = taskListItem.array()
const anySchema = z.any()

export function useBoard() {
  const { session } = useAuth()
  const access = useAccess()
  return useQuery({
    queryKey: ['tasks', 'board'],
    queryFn: () => callApi('/tasks/board', { responseSchema: board }),
    enabled: !!session && access.hasModule('tasks'),
    staleTime: 15_000,
  })
}

export function useSetBoardOrder() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: SetBoardOrderRequest) =>
      callApi('/tasks/board/order', { method: 'POST', body: input, responseSchema: anySchema }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['tasks', 'board'] }),
  })
}

export function useUpdateTaskStatus() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, status }: { id: string; status: TaskStatus }) =>
      callApi(`/tasks/${id}/status`, { method: 'PATCH', body: { status }, responseSchema: anySchema }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['tasks', 'board'] }),
  })
}

export function useGenerateTasks() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (project_id: string) =>
      callApi('/tasks/generate', {
        method: 'POST',
        body: { project_id, assignees: [] },
        responseSchema: z.object({ created: z.number() }),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['tasks'] }),
  })
}
