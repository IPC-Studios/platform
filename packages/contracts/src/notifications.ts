import { z } from 'zod'
import { uuid, isoDateTime } from './shared/primitives'

export const notificationSeverity = z.enum(['info', 'warning', 'critical'])
export type NotificationSeverity = z.infer<typeof notificationSeverity>

export const notification = z.object({
  id: uuid,
  type: z.string(),
  severity: notificationSeverity.default('info'),
  title: z.string(),
  body: z.string().nullable(),
  read_at: isoDateTime.nullable(),
  dismissed_at: isoDateTime.nullable().default(null),
  deep_link: z.string().nullable().default(null),
  meta: z.record(z.unknown()).default({}),
  entity_type: z.string().nullable().default(null),
  entity_id: uuid.nullable().default(null),
  created_at: isoDateTime,
})
export type Notification = z.infer<typeof notification>

/** GET /notifications query — Lovable parity filters, all optional. */
export const notificationsQuery = z.object({
  unread_only: z
    .union([z.literal('1'), z.literal('0'), z.literal('true'), z.literal('false')])
    .optional()
    .transform((v) => v === '1' || v === 'true'),
  severity: notificationSeverity.optional(),
  type: z.string().trim().max(80).optional(),
  type_prefix: z.string().trim().max(40).optional(),
  date_from: isoDateTime.optional(),
  date_to: isoDateTime.optional(),
  include_dismissed: z
    .union([z.literal('1'), z.literal('0'), z.literal('true'), z.literal('false')])
    .optional()
    .transform((v) => v === '1' || v === 'true'),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  cursor: isoDateTime.optional(),
})
export type NotificationsQuery = z.infer<typeof notificationsQuery>

export const unreadCountResponse = z.object({ unread_count: z.number().int() })
export type UnreadCountResponse = z.infer<typeof unreadCountResponse>

/** The 8 Lovable notification generators, runnable dry or live. */
export const notificationGeneratorKey = z.enum([
  'allocation_conflicts',
  'reminders',
  'tasks',
  'shoots',
  'data_pending',
  'backup_pending',
  'payment_pending',
  'crm_follow_ups',
])
export type NotificationGeneratorKey = z.infer<typeof notificationGeneratorKey>

export const runGeneratorRequest = z.object({
  key: notificationGeneratorKey,
  dry_run: z.boolean().default(true),
  date_from: isoDateTime.optional(),
  date_to: isoDateTime.optional(),
})
export type RunGeneratorRequest = z.infer<typeof runGeneratorRequest>

export const runGeneratorResponse = z.object({
  key: z.string(),
  dry_run: z.boolean(),
  generated: z.number().int().default(0),
  deduped: z.number().int().default(0),
  scanned: z.number().int().default(0),
  summary: z.record(z.string(), z.number().int()).default({}),
})
export type RunGeneratorResponse = z.infer<typeof runGeneratorResponse>

export const dispatchEmailsRequest = z.object({
  dry_run: z.boolean().default(true),
  limit: z.number().int().min(1).max(200).default(50),
  notification_ids: z.array(uuid).max(200).optional(),
})
export type DispatchEmailsRequest = z.infer<typeof dispatchEmailsRequest>

export const dispatchEmailsResponse = z.object({
  dry_run: z.boolean(),
  attempted: z.number().int(),
  sent: z.number().int(),
  skipped: z.number().int(),
  failed: z.number().int(),
  provider_missing: z.number().int(),
})
export type DispatchEmailsResponse = z.infer<typeof dispatchEmailsResponse>

