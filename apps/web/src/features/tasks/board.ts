import type { TaskListItem, TaskPriority, TaskStatus } from '@ipc/contracts'

/**
 * Task list arithmetic — the tiles, the tabs and the filters.
 *
 * "Overdue" is the one that has to be derived rather than stored: it is a fact
 * about today, not about the task, and a status column claiming it would be
 * wrong by morning. Everything here takes `today` as an argument so a test
 * never depends on when it runs.
 */
export type TaskTab = 'all' | 'to_do' | 'in_progress' | 'completed' | 'overdue'

export const TASK_TABS: ReadonlyArray<{ value: TaskTab; label: string }> = [
  { value: 'all', label: 'All' },
  { value: 'to_do', label: 'To do' },
  { value: 'in_progress', label: 'In progress' },
  { value: 'completed', label: 'Completed' },
  { value: 'overdue', label: 'Overdue' },
]

export const STATUS_LABEL: Record<TaskStatus, string> = {
  to_do: 'To do',
  in_progress: 'In progress',
  completed: 'Completed',
  cancelled: 'Cancelled',
}

export const PRIORITY_LABEL: Record<TaskPriority, string> = {
  low: 'Low',
  medium: 'Medium',
  high: 'High',
  urgent: 'Urgent',
}

/** Past its due date and still open. A finished task is never overdue. */
export function isOverdue(task: TaskListItem, today: string): boolean {
  if (task.status === 'completed' || task.status === 'cancelled') return false
  if (!task.due_date) return false
  return task.due_date < today
}

export interface TaskSummary {
  total: number
  toDo: number
  inProgress: number
  completed: number
  overdue: number
}

/**
 * `total` counts the live board — cancelled work is not work outstanding, and
 * counting it makes every other number read as a smaller share than it is.
 */
export function summarise(tasks: readonly TaskListItem[], today: string): TaskSummary {
  const live = tasks.filter((t) => t.status !== 'cancelled')
  return {
    total: live.length,
    toDo: live.filter((t) => t.status === 'to_do').length,
    inProgress: live.filter((t) => t.status === 'in_progress').length,
    completed: live.filter((t) => t.status === 'completed').length,
    overdue: live.filter((t) => isOverdue(t, today)).length,
  }
}

export function matchesTab(task: TaskListItem, tab: TaskTab, today: string): boolean {
  if (task.status === 'cancelled') return false
  switch (tab) {
    case 'all':
      return true
    case 'overdue':
      return isOverdue(task, today)
    default:
      return task.status === tab
  }
}

export function tabCounts(
  tasks: readonly TaskListItem[],
  today: string,
): Record<TaskTab, number> {
  const counts = {} as Record<TaskTab, number>
  for (const { value } of TASK_TABS) {
    counts[value] = tasks.filter((t) => matchesTab(t, value, today)).length
  }
  return counts
}

export interface TaskFilters {
  search: string
  priority: TaskPriority | 'all'
}

export const EMPTY_FILTERS: TaskFilters = { search: '', priority: 'all' }

function matchesSearch(task: TaskListItem, search: string): boolean {
  const needle = search.trim().toLowerCase()
  if (!needle) return true
  return [task.title, task.description, task.project_name, ...task.assignee_names]
    .filter(Boolean)
    .some((v) => String(v).toLowerCase().includes(needle))
}

const PRIORITY_RANK: Record<TaskPriority, number> = { urgent: 0, high: 1, medium: 2, low: 3 }

/**
 * Late work first, then whatever is due soonest, then by priority. A task with
 * no due date sinks below dated ones — it is not urgent, it is unscheduled.
 *
 * Finished work sinks below all of it: on a mixed list the question is what is
 * left to do, and a completed task outranking an open one because it happened
 * to be marked urgent is noise.
 */
export function byUrgency(today: string) {
  return (a: TaskListItem, b: TaskListItem): number => {
    const aDone = a.status === 'completed'
    const bDone = b.status === 'completed'
    if (aDone !== bDone) return aDone ? 1 : -1

    const aLate = isOverdue(a, today)
    const bLate = isOverdue(b, today)
    if (aLate !== bLate) return aLate ? -1 : 1
    if (a.due_date !== b.due_date) {
      if (!a.due_date) return 1
      if (!b.due_date) return -1
      return a.due_date.localeCompare(b.due_date)
    }
    if (a.priority !== b.priority) return PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority]
    return a.title.localeCompare(b.title)
  }
}

export function filterTasks(
  tasks: readonly TaskListItem[],
  tab: TaskTab,
  filters: TaskFilters,
  today: string,
): TaskListItem[] {
  return tasks
    .filter((t) => matchesTab(t, tab, today))
    .filter((t) => (filters.priority === 'all' ? true : t.priority === filters.priority))
    .filter((t) => matchesSearch(t, filters.search))
    .sort(byUrgency(today))
}

/** Today in the browser's timezone, as an ISO date for comparing due dates. */
export const todayISO = (now: Date = new Date()): string =>
  `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
