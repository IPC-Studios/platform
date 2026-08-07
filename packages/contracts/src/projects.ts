import { z } from 'zod'
import { uuid, isoDate, isoDateTime, money } from './shared/primitives'

export const projectStatus = z.enum(['active', 'completed', 'cancelled', 'on_hold'])
export type ProjectStatus = z.infer<typeof projectStatus>

export const deliverableVisibility = z.enum(['client', 'internal'])
export const deliverableStartRule = z.enum([
  'this_shoot',
  'whole_project',
  'specific_shoots',
  'no_data',
])

/** A deliverable as sent when creating a project. */
export const deliverableInput = z.object({
  title: z.string().trim().min(1).max(200),
  description: z.string().max(2000).optional(),
  list_key: z.string().min(1).max(40).default('primary'),
  is_additional_charge: z.boolean().default(false),
  additional_charge_amount: money.default(0),
  visibility_scope: deliverableVisibility.default('client'),
  show_on_quotation: z.boolean().default(true),
  estimated_date: isoDate.optional(),
  start_rule: deliverableStartRule.default('whole_project'),
  delivery_days_after_start: z.number().int().min(0).optional(),
  work_type: z.string().max(80).optional(),
  internal_notes: z.string().max(2000).optional(),
})
export type DeliverableInput = z.infer<typeof deliverableInput>

export const paymentInput = z.object({
  amount: money,
  paid_on: isoDate.optional(),
  mode: z.string().max(40).optional(),
  reference: z.string().max(120).optional(),
  notes: z.string().max(500).optional(),
})
export type PaymentInput = z.infer<typeof paymentInput>

export const createProjectRequest = z.object({
  client_id: uuid,
  name: z.string().trim().min(1).max(200),
  package_cost: money.default(0),
  status: projectStatus.default('active'),
  show_quotation: z.boolean().default(false),
  deliverables: z.array(deliverableInput).default([]),
  payments: z.array(paymentInput).default([]),
})
export type CreateProjectRequest = z.infer<typeof createProjectRequest>

export const updateProjectRequest = z.object({
  name: z.string().trim().min(1).max(200).optional(),
  status: projectStatus.optional(),
  package_cost: money.optional(),
  show_quotation: z.boolean().optional(),
})
export type UpdateProjectRequest = z.infer<typeof updateProjectRequest>

/** Row shape in the project list. */
export const projectListItem = z.object({
  id: uuid,
  name: z.string(),
  status: projectStatus,
  client_id: uuid,
  client_name: z.string().nullable(),
  package_cost: money,
  total_cost: money,
  created_at: isoDateTime,
})
export type ProjectListItem = z.infer<typeof projectListItem>

/** Deliverable as returned by the API — DB nulls tolerated (not input's optionals). */
export const deliverable = z.object({
  id: uuid,
  project_id: uuid,
  title: z.string(),
  description: z.string().nullish(),
  list_key: z.string(),
  is_additional_charge: z.boolean(),
  additional_charge_amount: money,
  visibility_scope: deliverableVisibility,
  show_on_quotation: z.boolean(),
  estimated_date: isoDate.nullish(),
  start_rule: deliverableStartRule,
  delivery_days_after_start: z.number().int().nullish(),
  work_type: z.string().nullish(),
  internal_notes: z.string().nullish(),
  status: z.string(),
})

export const projectDetail = z.object({
  id: uuid,
  name: z.string(),
  status: projectStatus,
  client_id: uuid,
  package_cost: money,
  additional_deliverables_cost: money,
  total_cost: money,
  show_quotation: z.boolean(),
  created_at: isoDateTime,
  deliverables: z.array(deliverable),
  payments: z.array(
    z.object({
      id: uuid,
      amount: money,
      paid_on: isoDate,
      mode: z.string().nullable(),
      reference: z.string().nullable(),
    }),
  ),
})
export type ProjectDetail = z.infer<typeof projectDetail>
