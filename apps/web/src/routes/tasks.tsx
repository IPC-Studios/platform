import { useMemo, useState, type FormEvent, type ReactNode } from 'react'
import { Link } from '@tanstack/react-router'
import {
  CalendarClock,
  CheckCircle2,
  Circle,
  Clock,
  FolderOpen,
  ListChecks,
  Package,
  Plus,
  Sparkles,
  Trash2,
  Users,
} from 'lucide-react'
import type { TaskListItem, TaskPriority, TaskStatus } from '@ipc/contracts'
import { AuthedPage } from '@/shared/layout/AuthedPage'
import { PageHeader } from '@/shared/layout/page-header'
import { FilterTabs } from '@/shared/layout/filter-tabs'
import { Button } from '@/shared/ui/button'
import { Card, CardContent } from '@/shared/ui/card'
import { cn } from '@/shared/ui/cn'
import { Dialog, DialogClose, DialogContent, DialogTrigger } from '@/shared/ui/dialog'
import { HowToUse } from '@/shared/ui/how-to-use'
import { Input, Label, Select } from '@/shared/ui/input'
import { StatusBadge } from '@/shared/ui/status-badge'
import { EmptyState, ErrorState, LoadingState } from '@/shared/ui/states'
import { useConfirm } from '@/shared/ui/confirm'
import { useIsMobile } from '@/shared/hooks/use-mobile'
import { useProjects } from '@/features/projects/api'
import {
  useApplyBundle,
  useBundles,
  useCreateBundle,
  useCreateTask,
  useDeleteBundle,
  useSetTaskStatus,
  useTasks,
} from '@/features/tasks/api'
import {
  EMPTY_FILTERS,
  PRIORITY_LABEL,
  STATUS_LABEL,
  TASK_TABS,
  filterTasks,
  isOverdue,
  summarise,
  tabCounts,
  todayISO,
  type TaskFilters,
  type TaskTab,
} from '@/features/tasks/board'

const PRIORITY_TONE: Record<TaskPriority, 'danger' | 'warning' | 'neutral' | 'info'> = {
  urgent: 'danger',
  high: 'warning',
  medium: 'neutral',
  low: 'info',
}


const dayFormat = new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short' })

export function TasksPage() {
  return (
    <AuthedPage module="tasks">
      <Tasks />
    </AuthedPage>
  )
}

function Tasks() {
  const [tab, setTab] = useState<TaskTab>('all')
  const [filters, setFilters] = useState<TaskFilters>(EMPTY_FILTERS)
  const { data, isLoading, isError, refetch } = useTasks()

  const today = todayISO()
  const tasks = useMemo(() => data ?? [], [data])
  const totals = useMemo(() => summarise(tasks, today), [tasks, today])
  const counts = useMemo(() => tabCounts(tasks, today), [tasks, today])
  const rows = useMemo(() => filterTasks(tasks, tab, filters, today), [tasks, tab, filters, today])

  return (
    <>
      <HowToUse
        title="Track team work"
        description="Create tasks for editing, delivery, follow-up, and operations."
        steps={['Add the task and its details.', 'Assign it to a team member.', 'Track it to done.']}
      />

      <div className="mt-6">
        <PageHeader
          title="Task management"
          description="All tasks across your studio — assign, track, and close out work."
          actions={
            <>
              <BundlesDialog />
              <NewTaskDialog />
            </>
          }
        />
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <Tile icon={ListChecks} label="Total" value={totals.total} />
        <Tile icon={Circle} label="To do" value={totals.toDo} tone="info" />
        <Tile icon={Clock} label="In progress" value={totals.inProgress} tone="warning" />
        <Tile icon={CheckCircle2} label="Completed" value={totals.completed} tone="success" />
        <Tile icon={CalendarClock} label="Overdue" value={totals.overdue} tone="danger" />
      </div>

      <div className="mt-4 grid gap-3 lg:grid-cols-2">
        <FeatureCard
          icon={Package}
          title="Task bundles"
          description="Reusable checklists for the work you repeat — wedding editing, album delivery, client onboarding, shoot prep."
          action={<BundlesDialog trigger={<Button variant="outline">Manage bundles</Button>} />}
        />
        <FeatureCard
          icon={Sparkles}
          title="Generate tasks from deliverables"
          description="Open a project and turn its deliverables into tasks in one step, instead of typing them out again."
          action={
            <Button variant="outline" asChild>
              <Link to="/projects">
                <FolderOpen /> Go to projects
              </Link>
            </Button>
          }
        />
      </div>

      <div className="mt-6">
        <FilterTabs<TaskTab>
          tabs={TASK_TABS.map((t) => ({ ...t, count: counts[t.value] }))}
          value={tab}
          onChange={setTab}
        />
      </div>

      <div className="mt-4 grid gap-3 rounded-xl border border-border bg-card p-4 sm:grid-cols-3">
        <div className="sm:col-span-2">
          <Input
            value={filters.search}
            onChange={(e) => setFilters({ ...filters, search: e.target.value })}
            placeholder="Search title, description, project or assignee…"
            aria-label="Search tasks"
          />
        </div>
        <Select
          value={filters.priority}
          onChange={(e) =>
            setFilters({ ...filters, priority: e.target.value as TaskFilters['priority'] })
          }
          aria-label="Priority"
        >
          <option value="all">All priorities</option>
          {(['urgent', 'high', 'medium', 'low'] as TaskPriority[]).map((p) => (
            <option key={p} value={p}>
              {PRIORITY_LABEL[p]}
            </option>
          ))}
        </Select>
      </div>

      <div className="mt-4">
        {isLoading ? (
          <LoadingState />
        ) : isError ? (
          <ErrorState onRetry={() => void refetch()} />
        ) : rows.length === 0 ? (
          <Card>
            <CardContent className="py-4">
              <EmptyState
                title={tasks.length === 0 ? 'No tasks yet' : 'Nothing matches these filters'}
                description={
                  tasks.length === 0
                    ? 'Create your first task, or use a bundle to raise a whole checklist at once.'
                    : 'Try another tab, or clear the search.'
                }
                action={
                  tasks.length === 0 ? (
                    <div className="flex flex-wrap justify-center gap-2">
                      <NewTaskDialog />
                      <BundlesDialog trigger={<Button variant="outline">Task bundles</Button>} />
                      <Button variant="outline" asChild>
                        <Link to="/projects">Projects</Link>
                      </Button>
                    </div>
                  ) : undefined
                }
              />
            </CardContent>
          </Card>
        ) : (
          <TaskTable rows={rows} today={today} />
        )}
      </div>
    </>
  )
}

function Tile({
  icon: Icon,
  label,
  value,
  tone = 'neutral',
}: {
  icon: typeof ListChecks
  label: string
  value: number
  tone?: 'success' | 'danger' | 'info' | 'warning' | 'neutral'
}) {
  const toneClass = {
    success: 'bg-success/15 text-success',
    danger: 'bg-destructive/10 text-destructive',
    info: 'bg-primary/10 text-primary',
    warning: 'bg-warning/15 text-warning',
    neutral: 'bg-muted text-muted-foreground',
  }[tone]

  return (
    <Card>
      <CardContent className="flex items-center gap-3 p-4">
        <span className={cn('flex size-9 shrink-0 items-center justify-center rounded-lg', toneClass)}>
          <Icon className="size-4" />
        </span>
        <div className="min-w-0">
          <p className="text-xl font-semibold tabular-nums">{value}</p>
          <p className="truncate text-xs text-muted-foreground">{label}</p>
        </div>
      </CardContent>
    </Card>
  )
}

function FeatureCard({
  icon: Icon,
  title,
  description,
  action,
}: {
  icon: typeof Package
  title: string
  description: string
  action: ReactNode
}) {
  return (
    <Card>
      <CardContent className="flex gap-3 p-4">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <Icon className="size-4" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="font-medium">{title}</p>
          <p className="mt-0.5 text-sm text-muted-foreground">{description}</p>
          <div className="mt-3">{action}</div>
        </div>
      </CardContent>
    </Card>
  )
}

function TaskTable({ rows, today }: { rows: readonly TaskListItem[]; today: string }) {
  const setStatus = useSetTaskStatus()
  const isMobile = useIsMobile()

  const StatusSelect = ({ task }: { task: TaskListItem }) => (
    <Select
      value={task.status}
      onChange={(e) => setStatus.mutate({ id: task.id, status: e.target.value as TaskStatus })}
      disabled={setStatus.isPending}
      aria-label={`Status for ${task.title}`}
      className="h-8 w-36"
    >
      {(['to_do', 'in_progress', 'completed', 'cancelled'] as TaskStatus[]).map((s) => (
        <option key={s} value={s}>
          {STATUS_LABEL[s]}
        </option>
      ))}
    </Select>
  )

  if (isMobile) {
    return (
      <div className="flex flex-col gap-3">
        {rows.map((t) => (
          <div key={t.id} className="rounded-lg border border-border p-4">
            <div className="flex items-start justify-between gap-2">
              <p className="font-medium">{t.title}</p>
              <StatusBadge tone={PRIORITY_TONE[t.priority]}>{PRIORITY_LABEL[t.priority]}</StatusBadge>
            </div>
            {t.project_name && (
              <p className="mt-1 truncate text-sm text-muted-foreground">{t.project_name}</p>
            )}
            <div className="mt-3 flex items-center gap-2">
              <StatusSelect task={t} />
              <DueBadge task={t} today={today} />
            </div>
          </div>
        ))}
      </div>
    )
  }

  return (
    <div className="overflow-x-auto rounded-lg border border-border">
      <table className="w-full text-sm">
        <thead className="bg-muted/50 text-left text-muted-foreground">
          <tr>
            <th className="min-w-64 px-4 py-2 font-medium">Task</th>
            <th className="px-4 py-2 font-medium">Project</th>
            <th className="px-4 py-2 font-medium">Assigned</th>
            <th className="px-4 py-2 font-medium">Priority</th>
            <th className="px-4 py-2 font-medium">Due</th>
            <th className="px-4 py-2 font-medium">Status</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((t) => (
            <tr key={t.id} className="border-t border-border hover:bg-muted/30">
              <td className="px-4 py-2">
                <p className={cn('font-medium', t.status === 'completed' && 'text-muted-foreground line-through')}>
                  {t.title}
                </p>
                {t.description && (
                  <p className="truncate text-xs text-muted-foreground">{t.description}</p>
                )}
              </td>
              <td className="px-4 py-2 text-muted-foreground">{t.project_name ?? '—'}</td>
              <td className="px-4 py-2 text-muted-foreground">
                {t.assignee_names.length ? (
                  <span className="flex items-center gap-1.5">
                    <Users className="size-3.5 shrink-0" />
                    {t.assignee_names.join(', ')}
                  </span>
                ) : (
                  <span className="text-warning">Unassigned</span>
                )}
              </td>
              <td className="px-4 py-2">
                <StatusBadge tone={PRIORITY_TONE[t.priority]}>{PRIORITY_LABEL[t.priority]}</StatusBadge>
              </td>
              <td className="px-4 py-2">
                <DueBadge task={t} today={today} />
              </td>
              <td className="px-4 py-2">
                <StatusSelect task={t} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function DueBadge({ task, today }: { task: TaskListItem; today: string }) {
  if (!task.due_date) return <span className="text-xs text-muted-foreground">No date</span>
  const late = isOverdue(task, today)
  const label = dayFormat.format(new Date(`${task.due_date}T00:00:00`))
  return (
    <StatusBadge tone={late ? 'danger' : task.due_date === today ? 'warning' : 'neutral'}>
      {late ? `Overdue · ${label}` : task.due_date === today ? 'Due today' : label}
    </StatusBadge>
  )
}

function NewTaskDialog() {
  const create = useCreateTask()
  const { data: projects } = useProjects()
  const [open, setOpen] = useState(false)
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [projectId, setProjectId] = useState('')
  const [priority, setPriority] = useState<TaskPriority>('medium')
  const [dueDate, setDueDate] = useState('')

  function reset() {
    setTitle('')
    setDescription('')
    setProjectId('')
    setPriority('medium')
    setDueDate('')
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault()
    create.mutate(
      {
        title: title.trim(),
        project_id: projectId || null,
        deliverable_id: null,
        status: 'to_do',
        priority,
        assignees: [],
        ...(description.trim() ? { description: description.trim() } : {}),
        ...(dueDate ? { due_date: dueDate } : {}),
      },
      {
        onSuccess: () => {
          setOpen(false)
          reset()
        },
      },
    )
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o)
        if (!o) reset()
      }}
    >
      <DialogTrigger asChild>
        <Button>
          <Plus /> New task
        </Button>
      </DialogTrigger>
      <DialogContent title="New task" description="Assignees can be added from the production board.">
        <form onSubmit={onSubmit} className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <Label>
              Title <span className="text-destructive">*</span>
            </Label>
            <Input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Cull and select — Sharma wedding"
              autoFocus
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>Description</Label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              placeholder="What does done look like?"
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="flex flex-col gap-1.5">
              <Label>Project</Label>
              <Select value={projectId} onChange={(e) => setProjectId(e.target.value)}>
                <option value="">None</option>
                {(projects ?? []).map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </Select>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>Priority</Label>
              <Select value={priority} onChange={(e) => setPriority(e.target.value as TaskPriority)}>
                {(['low', 'medium', 'high', 'urgent'] as TaskPriority[]).map((p) => (
                  <option key={p} value={p}>
                    {PRIORITY_LABEL[p]}
                  </option>
                ))}
              </Select>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>Due date</Label>
              <Input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <DialogClose asChild>
              <Button type="button" variant="outline">
                Cancel
              </Button>
            </DialogClose>
            <Button type="submit" disabled={create.isPending || title.trim().length === 0}>
              {create.isPending ? 'Creating…' : 'Create task'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}

/** Build a checklist once; raise it against a project whenever it comes round. */
function BundlesDialog({ trigger }: { trigger?: ReactNode }) {
  const { data: bundles, isLoading } = useBundles()
  const { data: projects } = useProjects()
  const createBundle = useCreateBundle()
  const deleteBundle = useDeleteBundle()
  const applyBundle = useApplyBundle()
  const confirm = useConfirm()

  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [itemText, setItemText] = useState('')
  const [applyTo, setApplyTo] = useState<Record<string, string>>({})

  const items = itemText
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)

  async function onDelete(id: string, bundleName: string) {
    const yes = await confirm({
      title: `Delete the ${bundleName} bundle?`,
      description: 'Tasks already created from it stay. Only the checklist goes.',
      confirmLabel: 'Delete bundle',
      destructive: true,
    })
    if (yes) deleteBundle.mutate(id)
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger ?? <Button variant="outline">
        <Package /> Task bundles
      </Button>}</DialogTrigger>
      <DialogContent
        title="Task bundles"
        description="A checklist you raise again every time the same job comes round."
        className="max-h-[85vh] max-w-2xl overflow-y-auto"
      >
        <div className="flex flex-col gap-5">
          <div>
            <p className="mb-2 text-sm font-medium">Your bundles</p>
            {isLoading ? (
              <LoadingState />
            ) : !bundles || bundles.length === 0 ? (
              <p className="rounded-lg border border-dashed border-border p-4 text-center text-sm text-muted-foreground">
                No bundles yet. Create one below.
              </p>
            ) : (
              <ul className="flex flex-col gap-2">
                {bundles.map((b) => (
                  <li key={b.id} className="rounded-lg border border-border p-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="min-w-0 flex-1 truncate font-medium">{b.name}</p>
                      <StatusBadge>{b.items.length} tasks</StatusBadge>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => void onDelete(b.id, b.name)}
                        disabled={deleteBundle.isPending}
                      >
                        <Trash2 />
                        <span className="sr-only">Delete {b.name}</span>
                      </Button>
                    </div>
                    <p className="mt-1 truncate text-xs text-muted-foreground">
                      {b.items.map((i) => i.title).join(' · ')}
                    </p>
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      <Select
                        value={applyTo[b.id] ?? ''}
                        onChange={(e) => setApplyTo({ ...applyTo, [b.id]: e.target.value })}
                        className="h-8 w-52"
                        aria-label={`Project for ${b.name}`}
                      >
                        <option value="">No project</option>
                        {(projects ?? []).map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.name}
                          </option>
                        ))}
                      </Select>
                      <Button
                        size="sm"
                        disabled={applyBundle.isPending}
                        onClick={() =>
                          applyBundle.mutate({
                            id: b.id,
                            input: { project_id: applyTo[b.id] || null, assignees: [] },
                          })
                        }
                      >
                        Create {b.items.length} tasks
                      </Button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <form
            onSubmit={(e) => {
              e.preventDefault()
              createBundle.mutate(
                { name: name.trim(), items: items.map((title) => ({ title, priority: 'medium' })) },
                {
                  onSuccess: () => {
                    setName('')
                    setItemText('')
                  },
                },
              )
            }}
            className="flex flex-col gap-3 border-t border-border pt-5"
          >
            <p className="text-sm font-medium">New bundle</p>
            <div className="flex flex-col gap-1.5">
              <Label>Name</Label>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Wedding editing"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>Tasks — one per line</Label>
              <textarea
                value={itemText}
                onChange={(e) => setItemText(e.target.value)}
                rows={5}
                placeholder={'Cull and select\nColour grade\nAlbum layout\nClient review'}
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
              <p className="text-xs text-muted-foreground">
                {items.length} {items.length === 1 ? 'task' : 'tasks'} · they keep this order.
              </p>
            </div>
            <div className="flex justify-end">
              <Button
                type="submit"
                disabled={createBundle.isPending || name.trim().length < 2 || items.length === 0}
              >
                {createBundle.isPending ? 'Saving…' : 'Save bundle'}
              </Button>
            </div>
          </form>
        </div>
      </DialogContent>
    </Dialog>
  )
}
