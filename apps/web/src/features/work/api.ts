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

/**
 * Send the work-submission nudges now instead of waiting for the hourly tick.
 *
 * Owner-only on the server. Useful straight after changing the day offsets —
 * otherwise the only way to know the settings do anything is to wait an hour.
 */
export function useRunWorkReminders() {
  return useMutation({
    mutationFn: () =>
      callApi('/work/reminders/run', {
        method: 'POST',
        responseSchema: z.object({ ok: z.boolean(), summary: z.record(z.unknown()).default({}) }),
      }),
    onSuccess: () => toast.success('Reminders sent'),
    onError: (e: Error) => toast.error(e.message),
  })
}

/**
 * Mint a client-facing delivery link for a finished submission.
 *
 * The send dialog used to share `submission_link` -- the raw internal URL the
 * editor pasted, a Drive folder as often as not. That has no expiry, cannot
 * be revoked, and leaves no record of what was sent to whom. All three of
 * those exist server-side (`deliver_work_to_client`, the revoke endpoint,
 * `team_work_client_deliveries`) and nothing had ever called them.
 */
export function useDeliverWork() {
  return useMutation({
    mutationFn: ({ id, channel }: { id: string; channel: string }) =>
      callApi(`/work/submissions/${id}/deliver`, {
        method: 'POST',
        body: { channel },
        responseSchema: z.object({ token: z.string(), link: z.string() }),
      }),
    onError: (e: Error) => toast.error(e.message),
  })
}
