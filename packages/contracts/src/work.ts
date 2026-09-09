import { z } from 'zod'
import { uuid, isoDateTime } from './shared/primitives'

export const workStatus = z.enum(['submitted', 'approved', 'rejected'])

export const workSubmission = z.object({
  id: uuid,
  project_id: uuid.nullable(),
  task_id: uuid.nullable(),
  submission_link: z.string().nullable(),
  location_note: z.string().nullable(),
  notes: z.string().nullable(),
  status: workStatus,
  review_notes: z.string().nullable(),
  created_at: isoDateTime,
})
export type WorkSubmission = z.infer<typeof workSubmission>

export const submitWorkRequest = z.object({
  task_id: uuid.nullable().default(null),
  project_id: uuid.nullable().default(null),
  submission_link: z.string().trim().min(1).max(500),
  /** Which physical drive or folder this actually lives on, if the link alone doesn't say. */
  location_note: z.string().trim().max(200).optional(),
  notes: z.string().max(1000).optional(),
})
export type SubmitWorkRequest = z.infer<typeof submitWorkRequest>

/** Same shape as submission, minus which task/project it's against -- that link doesn't change after the fact. */
export const updateWorkSubmissionRequest = submitWorkRequest.omit({ task_id: true, project_id: true })
export type UpdateWorkSubmissionRequest = z.infer<typeof updateWorkSubmissionRequest>

export const reviewWorkRequest = z.object({
  approve: z.boolean(),
  review_notes: z.string().max(1000).optional(),
})
export type ReviewWorkRequest = z.infer<typeof reviewWorkRequest>

export const workReminderSettings = z.object({
  enabled: z.boolean(),
  reminder_days: z.array(z.number().int()),
})
export type WorkReminderSettings = z.infer<typeof workReminderSettings>

export const updateWorkReminderSettingsRequest = z.object({
  enabled: z.boolean(),
  reminder_days: z.array(z.number().int().min(0).max(60)).max(10),
})
export type UpdateWorkReminderSettingsRequest = z.infer<typeof updateWorkReminderSettingsRequest>
