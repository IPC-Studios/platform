import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import {
  reminderList,
  z,
  type CreateReminderRequest,
} from '@ipc/contracts'
import { callApi } from '@/shared/api/client'
import { useAuth } from '@/shared/auth/AuthProvider'

const created = z.object({ id: z.string().uuid() })
/** Mutation responses whose body the UI discards; unknown keeps `any` out of the app. */
const anySchema = z.unknown()

export type ReminderFilters = {
  status?: string | undefined
  priority?: string | undefined
  entity_type?: string | undefined
  due_from?: string | undefined
  due_to?: string | undefined
  overdue?: boolean | undefined
}

export function useReminders(filters?: ReminderFilters) {
  const { session } = useAuth()
  const params = new URLSearchParams()
  if (filters?.status) params.set('status', filters.status)
  if (filters?.priority) params.set('priority', filters.priority)
  if (filters?.entity_type) params.set('entity_type', filters.entity_type)
  if (filters?.due_from) params.set('due_from', filters.due_from)
  if (filters?.due_to) params.set('due_to', filters.due_to)
  if (filters?.overdue) params.set('overdue', 'true')
  const qs = params.toString()

  return useQuery({
    queryKey: ['reminders', qs],
    queryFn: () => callApi(`/reminders${qs ? `?${qs}` : ''}`, { responseSchema: reminderList }),
    enabled: !!session,
    staleTime: 15_000,
  })
}

function useReminderMutation<TArgs, TResult>(fn: (a: TArgs) => Promise<TResult>, message: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: fn,
    onSuccess: () => {
      toast.success(message)
      void qc.invalidateQueries({ queryKey: ['reminders'] })
    },
  })
}

export function useSaveReminder() {
  return useReminderMutation(
    ({ id, body }: { id?: string | undefined; body: CreateReminderRequest }) =>
      callApi(id ? `/reminders/${id}` : '/reminders', {
        method: id ? 'PATCH' : 'POST',
        body,
        responseSchema: id ? anySchema : created,
      }),
    'Reminder saved',
  )
}

export function useUpdateReminderStatus() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) =>
      callApi(`/reminders/${id}/status`, {
        method: 'PATCH',
        body: { status },
        responseSchema: anySchema,
      }),
    onSuccess: () => {
      toast.success('Status updated')
      void qc.invalidateQueries({ queryKey: ['reminders'] })
    },
  })
}

export function useDeleteReminder() {
  return useReminderMutation(
    (id: string) => callApi(`/reminders/${id}`, { method: 'DELETE', responseSchema: anySchema }),
    'Reminder deleted',
  )
}
