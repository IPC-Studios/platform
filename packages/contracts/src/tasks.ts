import { z } from 'zod'
import { uuid, isoDate } from './shared/primitives'

export const taskStatus = z.enum(['to_do', 'in_progress', 'completed', 'cancelled'])
export type TaskStatus = z.infer<typeof taskStatus>

export const taskPriority = z.enum(['low', 'medium', 'high', 'urgent'])
export type TaskPriority = z.infer<typeof taskPriority>

/** A task as shown in lists and on the board. */
export const taskListItem = z.object({
  id: uuid,
  title: z.string(),
  status: taskStatus,
  priority: taskPriority,
  due_date: isoDate.nullable(),
  project_id: uuid.nullable(),
  project_name: z.string().nullable(),
  sort_order: z.number().int().default(0),
})
export type TaskListItem = z.infer<typeof taskListItem>

export const createTaskRequest = z.object({
  project_id: uuid.nullable().default(null),
  deliverable_id: uuid.nullable().default(null),
  title: z.string().trim().min(1).max(200),
  status: taskStatus.default('to_do'),
  priority: taskPriority.default('medium'),
  due_date: isoDate.optional(),
  assignees: z.array(uuid).default([]),
})
export type CreateTaskRequest = z.infer<typeof createTaskRequest>

export const updateTaskStatusRequest = z.object({ status: taskStatus })
export type UpdateTaskStatusRequest = z.infer<typeof updateTaskStatusRequest>

export const generateTasksRequest = z.object({
  project_id: uuid,
  assignees: z.array(uuid).default([]),
})
export type GenerateTasksRequest = z.infer<typeof generateTasksRequest>

/** Persist a lane's card order after a drag. */
export const setBoardOrderRequest = z.object({
  board_view: z.string().default('default'),
  lane_key: taskStatus,
  task_ids: z.array(uuid),
})
export type SetBoardOrderRequest = z.infer<typeof setBoardOrderRequest>
