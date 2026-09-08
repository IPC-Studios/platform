import { z } from 'zod'
import { uuid, isoDateTime, money } from './shared/primitives'

export const projectTemplate = z.object({
  id: uuid,
  company_id: uuid,
  name: z.string(),
  description: z.string().nullable(),
  deliverables_json: z.array(z.object({
    name: z.string(),
    description: z.string().nullable(),
    quantity: z.number().int().positive(),
  })).default([]),
  shoots_json: z.array(z.object({
    name: z.string(),
    kind: z.string().nullable(),
    duration_hours: z.number().positive().nullable(),
  })).default([]),
  tasks_json: z.array(z.object({
    title: z.string(),
    priority: z.string().default('medium'),
    sort_order: z.number().int().default(0),
  })).default([]),
  created_at: isoDateTime,
})
export type ProjectTemplate = z.infer<typeof projectTemplate>

export const projectTemplateList = z.object({
  items: z.array(projectTemplate),
})
export type ProjectTemplateList = z.infer<typeof projectTemplateList>

export const createProjectTemplateRequest = z.object({
  name: z.string().trim().min(2).max(160),
  description: z.string().trim().max(1000).nullish(),
  deliverables_json: z.array(z.object({
    name: z.string().trim().min(1).max(200),
    description: z.string().trim().max(500).nullish(),
    quantity: z.number().int().positive().default(1),
  })).default([]),
  shoots_json: z.array(z.object({
    name: z.string().trim().min(1).max(200),
    kind: z.string().trim().max(100).nullish(),
    duration_hours: z.number().positive().nullish(),
  })).default([]),
  tasks_json: z.array(z.object({
    title: z.string().trim().min(1).max(200),
    priority: z.string().default('medium'),
    sort_order: z.number().int().default(0),
  })).default([]),
})
export type CreateProjectTemplateRequest = z.infer<typeof createProjectTemplateRequest>
