import { z } from 'zod'
import { uuid, isoDateTime } from './shared/primitives'

export const workStatus = z.enum(['submitted', 'approved', 'rejected'])

export const workSubmission = z.object({
  id: uuid,
  project_id: uuid.nullable(),
  task_id: uuid.nullable(),
  submission_link: z.string().nullable(),
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
  notes: z.string().max(1000).optional(),
})
export type SubmitWorkRequest = z.infer<typeof submitWorkRequest>

export const reviewWorkRequest = z.object({
  approve: z.boolean(),
  review_notes: z.string().max(1000).optional(),
})
export type ReviewWorkRequest = z.infer<typeof reviewWorkRequest>
