import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { workReminderSettings, z, type UpdateWorkReminderSettingsRequest } from '@ipc/contracts'

const noContent = z.unknown()
import { callApi } from '@/shared/api/client'
import { useAuth } from '@/shared/auth/AuthProvider'

/** When a team member is nudged to submit pending work before a task's due date. */
export function useWorkReminderSettings() {
  const { session } = useAuth()
  return useQuery({
    queryKey: ['work', 'reminder-settings'],
    queryFn: () => callApi('/work/reminder-settings', { responseSchema: workReminderSettings }),
    enabled: !!session,
    staleTime: 60_000,
  })
}

export function useUpdateWorkReminderSettings() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: UpdateWorkReminderSettingsRequest) =>
      callApi('/work/reminder-settings', { method: 'PATCH', body: input, responseSchema: noContent }),
    onSuccess: () => {
      toast.success('Reminder settings saved')
      void qc.invalidateQueries({ queryKey: ['work', 'reminder-settings'] })
    },
  })
}
