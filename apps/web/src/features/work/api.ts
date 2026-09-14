import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { workReminderSettings, workSubmission, z, type ReviewWorkRequest, type UpdateWorkReminderSettingsRequest } from '@ipc/contracts'
import { callApi } from '@/shared/api/client'
import { useAuth } from '@/shared/auth/AuthProvider'

const noContent = z.unknown()
const list = workSubmission.array()
const anySchema = z.any()

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

/** One project's own submitted work — its detail page's Completed Work tab. */
export function useProjectWorkSubmissions(projectId: string) {
  const { session } = useAuth()
  return useQuery({
    queryKey: ['work', 'submissions', 'project', projectId],
    queryFn: () => callApi(`/work/submissions?project_id=${projectId}`, { responseSchema: list }),
    enabled: !!session && !!projectId,
    staleTime: 15_000,
  })
}

export function useReviewWork() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, ...body }: { id: string } & ReviewWorkRequest) =>
      callApi(`/work/submissions/${id}/review`, { method: 'POST', body, responseSchema: anySchema }),
    onSuccess: (_data, { approve }) => {
      toast.success(approve ? 'Work approved' : 'Work sent back for changes')
      void qc.invalidateQueries({ queryKey: ['work', 'submissions'] })
    },
  })
}
