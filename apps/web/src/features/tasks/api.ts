import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import {
  applyBundleRequest,
  createBundleRequest,
  createTaskRequest,
  generateTasksRequest,
  taskBundle,
  taskListItem,
  z,
  type ApplyBundleRequest,
  type CreateBundleRequest,
  type CreateTaskRequest,
  type GenerateTasksRequest,
  type SetBoardOrderRequest,
  type TaskStatus,
} from '@ipc/contracts'
import { callApi } from '@/shared/api/client'
import { useAuth } from '@/shared/auth/AuthProvider'
import { useAccess } from '@/shared/auth/useAccess'

const tasksList = taskListItem.array()
const bundlesList = taskBundle.array()
const created = z.object({ id: z.string() })
const countOnly = z.object({ created: z.number() })
const anySchema = z.any()

export function useTasks() {
  const { session } = useAuth()
  const access = useAccess()
  return useQuery({
    queryKey: ['tasks', 'all'],
    queryFn: () => callApi('/tasks', { responseSchema: tasksList }),
    enabled: !!session && access.hasModule('tasks'),
    staleTime: 15_000,
  })
}

/** The production board's own view — same rows, lane order applied. */
export function useBoard() {
  const { session } = useAuth()
  const access = useAccess()
  return useQuery({
    queryKey: ['tasks', 'board'],
    queryFn: () => callApi('/tasks/board', { responseSchema: tasksList }),
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

/**
 * The board's status setter: same endpoint as useSetTaskStatus, but silent.
 * Dragging a card between lanes IS the feedback; a toast per drop is noise.
 */
export function useUpdateTaskStatus() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, status }: { id: string; status: TaskStatus }) =>
      callApi(`/tasks/${id}/status`, { method: 'PATCH', body: { status }, responseSchema: anySchema }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['tasks'] }),
  })
}

export function useBundles() {
  const { session } = useAuth()
  const access = useAccess()
  return useQuery({
    queryKey: ['tasks', 'bundles'],
    queryFn: () => callApi('/tasks/bundles', { responseSchema: bundlesList }),
    enabled: !!session && access.hasModule('tasks'),
    staleTime: 60_000,
  })
}

function useTaskMutation<TInput, TOutput>(
  fn: (input: TInput) => Promise<TOutput>,
  success?: string | ((out: TOutput) => string),
) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: fn,
    onSuccess: (out) => {
      const msg = typeof success === 'function' ? success(out) : success
      if (msg) toast.success(msg)
      void qc.invalidateQueries({ queryKey: ['tasks'] })
    },
    onError: (e: Error) => toast.error(e.message),
  })
}

export function useCreateTask() {
  return useTaskMutation(
    (input: CreateTaskRequest) =>
      callApi('/tasks', {
        method: 'POST',
        body: createTaskRequest.parse(input),
        responseSchema: created,
      }),
    'Task created',
  )
}

export function useSetTaskStatus() {
  return useTaskMutation(
    ({ id, status }: { id: string; status: TaskStatus }) =>
      callApi(`/tasks/${id}/status`, {
        method: 'PATCH',
        body: { status },
        responseSchema: anySchema,
      }),
    'Task updated',
  )
}

export function useCreateBundle() {
  return useTaskMutation(
    (input: CreateBundleRequest) =>
      callApi('/tasks/bundles', {
        method: 'POST',
        body: createBundleRequest.parse(input),
        responseSchema: created,
      }),
    'Bundle saved',
  )
}

export function useDeleteBundle() {
  return useTaskMutation(
    (id: string) => callApi(`/tasks/bundles/${id}`, { method: 'DELETE', responseSchema: anySchema }),
    'Bundle deleted',
  )
}

export function useApplyBundle() {
  return useTaskMutation(
    ({ id, input }: { id: string; input: ApplyBundleRequest }) =>
      callApi(`/tasks/bundles/${id}/apply`, {
        method: 'POST',
        body: applyBundleRequest.parse(input),
        responseSchema: countOnly,
      }),
    (out) => `${out.created} ${out.created === 1 ? 'task' : 'tasks'} created`,
  )
}

/** Turn a project's deliverables into tasks, one per deliverable. */
export function useGenerateTasks() {
  return useTaskMutation(
    (input: GenerateTasksRequest) =>
      callApi('/tasks/generate', {
        method: 'POST',
        body: generateTasksRequest.parse(input),
        responseSchema: countOnly,
      }),
    (out) => `${out.created} ${out.created === 1 ? 'task' : 'tasks'} generated`,
  )
}
