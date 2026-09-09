import { z } from 'zod'
import { uuid, isoDateTime } from './shared/primitives'

export const reminderPriority = z.enum(['low', 'medium', 'high', 'urgent'])
export type ReminderPriority = z.infer<typeof reminderPriority>

export const reminderStatus = z.enum(['active', 'completed', 'dismissed'])
export type ReminderStatus = z.infer<typeof reminderStatus>

export const reminderEntityType = z.enum(['lead', 'project', 'client', 'invoice', 'enquiry', 'task', 'shoot', 'custom'])
export type ReminderEntityType = z.infer<typeof reminderEntityType>

export const reminder = z.object({
  id: uuid,
  company_id: uuid,
  /** Who it's for — the person who sees it in their list and can complete it. */
  user_id: uuid,
  /** Who made it — themself, or an admin setting a reminder for someone else. */
  created_by: uuid.nullable().default(null),
  title: z.string(),
  description: z.string().nullable(),
  priority: reminderPriority,
  status: reminderStatus,
  entity_type: reminderEntityType.nullable(),
  entity_id: uuid.nullable(),
  /** Resolved server-side from entity_type/entity_id — a lead's name, a project's name, and so on. */
  entity_name: z.string().nullable().default(null),
  due_at: isoDateTime.nullable(),
  created_at: isoDateTime,
})
export type Reminder = z.infer<typeof reminder>

export const reminderSummary = z.object({
  total_count: z.number().int(),
  active_count: z.number().int(),
  overdue_count: z.number().int(),
  due_today_count: z.number().int(),
})
export type ReminderSummary = z.infer<typeof reminderSummary>

export const reminderList = z.object({
  items: z.array(reminder),
  summary: reminderSummary,
})
export type ReminderList = z.infer<typeof reminderList>

export const createReminderRequest = z.object({
  title: z.string().trim().min(2).max(200),
  description: z.string().trim().max(2000).nullish(),
  priority: reminderPriority.default('medium'),
  entity_type: reminderEntityType.nullish(),
  entity_id: uuid.nullish(),
  due_at: isoDateTime.nullish(),
  /** Omit to set it for yourself; pass a teammate's id to set it for them instead. */
  assigned_to: uuid.nullish(),
})
export type CreateReminderRequest = z.infer<typeof createReminderRequest>
