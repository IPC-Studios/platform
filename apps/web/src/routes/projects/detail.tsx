import { useState, type FormEvent } from 'react'
import { Link, useNavigate, useParams } from '@tanstack/react-router'
import {
  ArrowRight,
  Briefcase,
  Camera,
  CheckSquare,
  CircleCheck,
  Clock,
  Database,
  FileSignature,
  FileText,
  Gift,
  IndianRupee,
  LayoutGrid,
  Package,
  PauseCircle,
  Pencil,
  Phone,
  Plus,
  Receipt,
  FileCheck,
  Trash2,
  Users,
  Wallet,
  X,
} from 'lucide-react'
import type {
  Deliverable,
  DeliverableInput,
  DeliverableStatus,
  PaymentInput,
  ProjectStatus,
  UpdateProjectRequest,
} from '@ipc/contracts'
import { AuthedPage } from '@/shared/layout/AuthedPage'
import { QuotationLinkDialog } from '@/features/projects/QuotationLinkDialog'
import { Breadcrumbs } from '@/shared/layout/breadcrumbs'
import { useAccess } from '@/shared/auth/useAccess'
import { useConfirm } from '@/shared/ui/confirm'
import { SkeletonCards } from '@/shared/ui/skeleton'
import { Card, CardContent, CardHeader, CardTitle } from '@/shared/ui/card'
import { StatusBadge } from '@/shared/ui/status-badge'
import { ErrorState, EmptyState } from '@/shared/ui/states'
import { Button } from '@/shared/ui/button'
import { Dialog, DialogClose, DialogContent, DialogTrigger } from '@/shared/ui/dialog'
import { Input, Label, Select } from '@/shared/ui/input'
import { formatINR, humanize } from '@/shared/ui/format'
import { cn } from '@/shared/ui/cn'
import {
  useProject,
  useUpdateProject,
  useAddDeliverable,
  useUpdateDeliverable,
  useDeleteDeliverable,
  useAddPayment,
  useDeleteProject,
} from '@/features/projects/api'
import { ShootsTab } from '@/features/projects/tabs/ShootsTab'
import { CompletedWorkTab } from '@/features/projects/tabs/CompletedWorkTab'
import { TermsTab } from '@/features/projects/tabs/TermsTab'
import { ExpensesTab } from '@/features/projects/tabs/ExpensesTab'
import { TasksTab } from '@/features/projects/tabs/TasksTab'
import { DataTab } from '@/features/projects/tabs/DataTab'

/** The tabs across a project. Each one is a view of the same project. */
const TABS = [
  { value: 'overview', label: 'Overview', icon: LayoutGrid },
  { value: 'shoots', label: 'Shoots', icon: Camera },
  { value: 'deliverables', label: 'Deliverables', icon: Package },
  { value: 'completed_work', label: 'Completed Work', icon: FileCheck },
  { value: 'terms', label: 'Terms', icon: FileSignature },
  { value: 'billing', label: 'Billing', icon: Wallet },
  { value: 'expenses', label: 'Expenses', icon: Receipt },
  { value: 'tasks', label: 'Tasks', icon: CheckSquare },
  { value: 'data', label: 'Data', icon: Database },
] as const
type Tab = (typeof TABS)[number]['value']

const STATUS_TONE: Record<ProjectStatus, 'info' | 'success' | 'danger' | 'warning'> = {
  active: 'info',
  completed: 'success',
  cancelled: 'danger',
  on_hold: 'warning',
}

const STATUS_ICON: Record<ProjectStatus, typeof Clock> = {
  active: Clock,
  completed: CircleCheck,
  cancelled: X,
  on_hold: PauseCircle,
}

const dayFormat = new Intl.DateTimeFormat('en-IN', {
  day: '2-digit',
  month: 'short',
  year: 'numeric',
})
const prettyDate = (iso: string) => dayFormat.format(new Date(iso))

const DELIVERABLE_STATUS_TONE: Record<string, 'neutral' | 'info' | 'success' | 'warning' | 'danger'> = {
  pending: 'warning',
  in_progress: 'info',
  completed: 'success',
  cancelled: 'danger',
}

export function ProjectDetailPage() {
  return (
    <AuthedPage module="projects">
      <ProjectDetail />
    </AuthedPage>
  )
}

function ProjectDetail() {
  const { id } = useParams({ from: '/authed/projects/$id' })
  const navigate = useNavigate()
  const { data, isLoading, isError, refetch } = useProject(id)
  const access = useAccess()
  const canEdit = access.hasAction('projects', 'edit')
  // The review endpoint is gated on team_work_preview, not projects — a project
  // editor without that permission would see the buttons but get a 403.
  const canReviewWork = access.hasAction('team_work_preview', 'edit')
  // Task status updates are gated on tasks:edit, not projects:edit.
  const canEditTasks = access.hasAction('tasks', 'edit')
  const del = useDeleteDeliverable(id)
  const updateDeliverable = useUpdateDeliverable(id)
  const update = useUpdateProject(id)
  const removeProject = useDeleteProject()
  const confirm = useConfirm()
  const [tab, setTab] = useState<Tab>('overview')

  if (isLoading) return <SkeletonCards count={3} />
  if (isError || !data) return <ErrorState onRetry={() => void refetch()} />

  const received = data.payments.reduce((s, p) => s + p.amount, 0)
  const balance = Math.max(0, data.total_cost - received)
  const StatusIcon = STATUS_ICON[data.status]

  async function removeDeliverable(dId: string, title: string) {
    if (await confirm({ title: `Remove "${title}"?`, destructive: true, confirmLabel: 'Remove' })) {
      del.mutate(dId)
    }
  }

  async function onDelete() {
    const yes = await confirm({
      title: `Delete ?`,
      description:
        'Its shoots, deliverables and tasks go with it. A project with payments recorded cannot be deleted — cancel it instead.',
      confirmLabel: 'Delete project',
      destructive: true,
    })
    if (yes) removeProject.mutate(id, { onSuccess: () => void navigate({ to: '/projects' }) })
  }

  return (
    <>
      <Breadcrumbs
        items={[
          { label: 'Home', to: '/dashboard' },
          { label: 'Projects', to: '/projects' },
          { label: data.name },
        ]}
      />

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-semibold tracking-tight">{data.name}</h1>
            <StatusBadge tone={STATUS_TONE[data.status]}>
              <StatusIcon className="mr-1 size-3" aria-hidden />
              {humanize(data.status)}
            </StatusBadge>
          </div>
          <p className="mt-0.5 text-sm text-muted-foreground">
            Created {prettyDate(data.created_at)}
          </p>
        </div>

        {canEdit && (
          <div className="flex flex-wrap items-center gap-2">
            {/* Status is one press here rather than buried in the edit dialog:
                it is the field that changes most often. */}
            <Select
              value={data.status}
              onChange={(e) => update.mutate({ status: e.target.value as ProjectStatus })}
              aria-label="Project status"
              className="w-40"
            >
              <option value="active">Active</option>
              <option value="on_hold">On hold</option>
              <option value="completed">Completed</option>
              <option value="cancelled">Cancelled</option>
            </Select>
            <EditProjectDialog
              id={id}
              name={data.name}
              status={data.status}
              packageCost={data.package_cost}
              showQuotation={data.show_quotation}
            />
            <Button
              variant="outline"
              className="text-destructive hover:bg-destructive/10"
              disabled={removeProject.isPending}
              onClick={() => void onDelete()}
            >
              <Trash2 /> Delete
            </Button>
          </div>
        )}
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Figure icon={IndianRupee} label="Total cost" value={formatINR(data.total_cost)} />
        <Figure icon={CircleCheck} label="Received" value={formatINR(received)} tone="success" />
        <Figure icon={Clock} label="Pending payments" value={formatINR(balance)} tone="warning" />
        <Figure icon={Briefcase} label="Balance" value={formatINR(balance)} tone="info" />
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-1 rounded-lg border border-border bg-card p-1.5">
        {TABS.map((t) => (
          <button
            key={t.value}
            type="button"
            onClick={() => setTab(t.value)}
            aria-current={tab === t.value ? 'page' : undefined}
            className={cn(
              'flex items-center gap-2 rounded-full px-3.5 py-1.5 text-sm font-medium transition-colors',
              tab === t.value
                ? 'bg-primary text-primary-foreground'
                : 'text-muted-foreground hover:bg-accent hover:text-foreground',
            )}
          >
            <t.icon className="size-4" aria-hidden />
            {t.label}
          </button>
        ))}
      </div>

      {canEdit && (
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Quick actions:
          </span>
          <QuotationLinkDialog projectId={id} />
          <Button variant="ghost" size="sm" asChild>
            <Link to="/team-allocation">
              <Users /> Allocation
            </Link>
          </Button>
          <Button variant="ghost" size="sm" asChild>
            <Link to="/referrals">
              <Gift /> Refer &amp; Earn
            </Link>
          </Button>
        </div>
      )}

      {tab === 'overview' && (
        <div className="mt-4 grid gap-4 lg:grid-cols-[1.6fr_1fr]">
          <div className="flex flex-col gap-4">
            <Card>
              <CardHeader className="pb-3">
                <CardTitle>Project &amp; client</CardTitle>
              </CardHeader>
              <CardContent className="grid gap-x-8 gap-y-2 sm:grid-cols-2">
                <Fact label="Project" value={data.name} />
                <Fact label="Status" value={humanize(data.status)} />
                <Fact label="Created" value={prettyDate(data.created_at)} />
                <Fact label="Client" value={data.client_name ?? '—'} />
                <Fact label="Phone" value={data.client_phone ?? '—'} />
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-3">
                <CardTitle>Financial snapshot</CardTitle>
              </CardHeader>
              <CardContent>
                <dl className="flex flex-col gap-2 text-sm">
                  <Money label="Package cost" value={data.package_cost} />
                  <Money label="Additional" value={data.additional_deliverables_cost} />
                  <Money label="Total project value" value={data.total_cost} accent />
                  <Money label="Received" value={received} />
                  <Money label="Balance due" value={balance} accent />
                </dl>
                {canEdit && (
                  <div className="mt-4 flex flex-wrap gap-2">
                    <AddPaymentDialog id={id} balance={balance} />
                    <Button variant="outline" size="sm" onClick={() => setTab('billing')}>
                      <FileText /> View payments
                    </Button>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          <Card className="self-start">
            <CardHeader className="pb-3">
              <CardTitle>Client</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="font-medium">{data.client_name ?? 'No client on file'}</p>
              {data.client_phone && (
                <a
                  href={`tel:${data.client_phone}`}
                  className="mt-1 flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
                >
                  <Phone className="size-3.5" aria-hidden />
                  {data.client_phone}
                </a>
              )}
              <Link
                to="/clients"
                className="mt-3 inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline"
              >
                View client <ArrowRight className="size-3.5" aria-hidden />
              </Link>
            </CardContent>
          </Card>
        </div>
      )}

      {tab === 'deliverables' && (
      <div className="mt-4 flex flex-col gap-4">
        <DeliverableGroup
          projectId={id}
          title="Client Deliverables"
          description="Shown on quotation and promised to the client."
          scope="client"
          items={data.deliverables.filter((d) => d.visibility_scope === 'client')}
          canEdit={canEdit}
          updateDeliverable={updateDeliverable}
          onRemove={removeDeliverable}
        />
        <DeliverableGroup
          projectId={id}
          title="Internal Work"
          description="Your team's own work items — never shown to the client."
          scope="internal"
          items={data.deliverables.filter((d) => d.visibility_scope === 'internal')}
          canEdit={canEdit}
          updateDeliverable={updateDeliverable}
          onRemove={removeDeliverable}
        />
      </div>
      )}

      {tab === 'billing' && (
      <div className="mt-4">
        <Card>
          <CardHeader className="flex-row items-center justify-between">
            <CardTitle>Payments</CardTitle>
            {canEdit && <AddPaymentDialog id={id} balance={balance} />}
          </CardHeader>
          <CardContent>
            {data.payments.length === 0 ? (
              <EmptyState
                title="No payments yet"
                description="Record an advance or an instalment and the balance updates here."
              />
            ) : (
              <ul className="divide-y divide-border">
                {data.payments.map((p) => (
                  <li key={p.id} className="flex items-center justify-between py-2 text-sm">
                    <span className="text-muted-foreground">
                      {p.paid_on} · {p.mode ?? '—'}
                    </span>
                    <span className="font-medium">{formatINR(p.amount)}</span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
      )}

      {tab === 'shoots' && <ShootsTab projectId={id} />}
      {tab === 'completed_work' && <CompletedWorkTab projectId={id} canReview={canReviewWork} />}
      {tab === 'terms' && <TermsTab projectId={id} canEdit={canEdit} />}
      {tab === 'expenses' && <ExpensesTab projectId={id} />}
      {tab === 'tasks' && <TasksTab projectId={id} canEdit={canEditTasks} />}
      {tab === 'data' && <DataTab projectId={id} canEdit={canEdit} />}
    </>
  )
}

/** One figure in the strip under the header: icon tile, number, label. */
function Figure({
  icon: Icon,
  label,
  value,
  tone,
}: {
  icon: typeof Clock
  label: string
  value: string
  tone?: 'success' | 'warning' | 'info'
}) {
  return (
    <Card>
      <CardContent className="flex items-center gap-3 p-4">
        <span
          className={cn(
            'flex size-10 shrink-0 items-center justify-center rounded-lg',
            tone === 'success'
              ? 'bg-success/10 text-success'
              : tone === 'warning'
                ? 'bg-warning/10 text-warning'
                : 'bg-primary/10 text-primary',
          )}
        >
          <Icon className="size-5" aria-hidden />
        </span>
        <div className="min-w-0">
          <p className="truncate text-xl font-semibold tabular-nums">{value}</p>
          <p className="truncate text-sm text-muted-foreground">{label}</p>
        </div>
      </CardContent>
    </Card>
  )
}

/** A label and its value, side by side, the way the reference reads them. */
function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-border/60 py-1.5 last:border-0">
      <span className="text-sm text-muted-foreground">{label}</span>
      <span className="min-w-0 truncate text-sm font-medium">{value}</span>
    </div>
  )
}

function Money({ label, value, accent }: { label: string; value: number; accent?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className={cn('tabular-nums', accent ? 'font-semibold text-primary' : 'font-medium')}>
        {formatINR(value)}
      </dd>
    </div>
  )
}

function EditProjectDialog({
  id,
  name,
  status,
  packageCost,
  showQuotation,
}: {
  id: string
  name: string
  status: ProjectStatus
  packageCost: number
  showQuotation: boolean
}) {
  const update = useUpdateProject(id)
  const [open, setOpen] = useState(false)
  const [form, setForm] = useState<UpdateProjectRequest>({
    name,
    status,
    package_cost: packageCost,
    show_quotation: showQuotation,
  })
  // Kept separate from `form.package_cost` (a number, for the request body) so
  // the field displays exactly what was typed instead of fighting a
  // type="number" input's leading-zero quirks.
  const [packageCostText, setPackageCostText] = useState(String(packageCost))

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    await update.mutateAsync(form)
    setOpen(false)
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <Pencil /> Edit
        </Button>
      </DialogTrigger>
      <DialogContent title="Edit project">
        <form onSubmit={onSubmit} className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <Label>Name</Label>
            <Input value={form.name ?? ''} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <Label>Status</Label>
              <Select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value as ProjectStatus })}>
                <option value="active">Active</option>
                <option value="on_hold">On hold</option>
                <option value="completed">Completed</option>
                <option value="cancelled">Cancelled</option>
              </Select>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>Package (₹)</Label>
              <Input
                inputMode="decimal"
                value={packageCostText}
                onChange={(e) => {
                  setPackageCostText(e.target.value)
                  setForm({ ...form, package_cost: e.target.value.trim() ? Number(e.target.value) : 0 })
                }}
              />
            </div>
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={form.show_quotation ?? false}
              onChange={(e) => setForm({ ...form, show_quotation: e.target.checked })}
            />
            Show quotation to client
          </label>
          <div className="flex justify-end gap-2">
            <DialogClose asChild>
              <Button type="button" variant="outline">
                Cancel
              </Button>
            </DialogClose>
            <Button type="submit" disabled={update.isPending}>
              {update.isPending ? 'Saving…' : 'Save'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function DeliverableGroup({
  projectId,
  title,
  description,
  scope,
  items,
  canEdit,
  updateDeliverable,
  onRemove,
}: {
  projectId: string
  title: string
  description: string
  scope: 'client' | 'internal'
  items: Deliverable[]
  canEdit: boolean
  updateDeliverable: ReturnType<typeof useUpdateDeliverable>
  onRemove: (deliverableId: string, title: string) => void
}) {
  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between">
        <div>
          <CardTitle className="flex items-center gap-2">
            {title}
            <StatusBadge tone="neutral">{items.length}</StatusBadge>
          </CardTitle>
          <p className="mt-0.5 text-sm text-muted-foreground">{description}</p>
        </div>
        {canEdit && (
          <AddDeliverableDialog
            id={projectId}
            defaultVisibility={scope}
            label={scope === 'client' ? 'Add client deliverable' : 'Add internal work'}
          />
        )}
      </CardHeader>
      <CardContent>
        {items.length === 0 ? (
          <EmptyState
            title={scope === 'client' ? 'No client deliverables yet' : 'No internal work yet'}
            description={
              scope === 'client'
                ? 'List what the client receives — the album, the film, the reel. Chargeable ones add to the project total.'
                : "Track your team's own work items here — they never reach the client."
            }
          />
        ) : (
          <ul className="flex flex-col gap-3">
            {items.map((d) => (
              <li key={d.id} className="rounded-lg border border-border p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="font-medium">{d.title}</p>
                  <StatusBadge tone={DELIVERABLE_STATUS_TONE[d.status] ?? 'neutral'}>
                    {humanize(d.status)}
                  </StatusBadge>
                  <StatusBadge tone={d.visibility_scope === 'client' ? 'info' : 'neutral'}>
                    {d.visibility_scope === 'client' ? 'Client deliverable' : 'Internal work'}
                  </StatusBadge>
                  <StatusBadge tone={d.show_on_quotation ? 'success' : 'neutral'}>
                    {d.show_on_quotation ? 'Shown on quotation' : 'Internal only'}
                  </StatusBadge>
                  {d.is_additional_charge && (
                    <span className="text-sm font-medium">{formatINR(d.additional_charge_amount)}</span>
                  )}
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <Input
                    type="date"
                    value={d.estimated_date ?? ''}
                    disabled={!canEdit}
                    onChange={(e) =>
                      updateDeliverable.mutate({
                        deliverableId: d.id,
                        patch: { estimated_date: e.target.value || null },
                      })
                    }
                    className="w-40"
                    aria-label={`Estimated delivery for ${d.title}`}
                  />
                  <Select
                    value={d.status}
                    disabled={!canEdit}
                    onChange={(e) =>
                      updateDeliverable.mutate({
                        deliverableId: d.id,
                        patch: { status: e.target.value as DeliverableStatus },
                      })
                    }
                    className="w-36"
                    aria-label={`Status for ${d.title}`}
                  >
                    <option value="pending">Pending</option>
                    <option value="in_progress">In progress</option>
                    <option value="completed">Completed</option>
                    <option value="cancelled">Cancelled</option>
                  </Select>
                  {canEdit && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() =>
                        updateDeliverable.mutate({
                          deliverableId: d.id,
                          patch: { visibility_scope: scope === 'client' ? 'internal' : 'client' },
                        })
                      }
                    >
                      {scope === 'client' ? 'To internal' : 'To client'}
                    </Button>
                  )}
                  {canEdit && <EditDeliverableDialog id={projectId} deliverable={d} />}
                  {canEdit && (
                    <Button variant="ghost" size="icon" onClick={() => onRemove(d.id, d.title)}>
                      <Trash2 />
                    </Button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  )
}

function AddDeliverableDialog({
  id,
  defaultVisibility = 'client',
  label = 'Add',
}: {
  id: string
  defaultVisibility?: 'client' | 'internal'
  label?: string
}) {
  const add = useAddDeliverable(id)
  const [open, setOpen] = useState(false)
  const [title, setTitle] = useState('')
  const [charge, setCharge] = useState(false)
  const [amount, setAmount] = useState('')
  const [workType, setWorkType] = useState('')
  const [internalNotes, setInternalNotes] = useState('')

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    const body: DeliverableInput = {
      title: title.trim(),
      list_key: 'primary',
      is_additional_charge: charge,
      additional_charge_amount: charge ? Number(amount) || 0 : 0,
      visibility_scope: defaultVisibility,
      // Internal work is never shown on the client's quotation by definition.
      show_on_quotation: defaultVisibility === 'client',
      start_rule: 'whole_project',
      ...(workType.trim() ? { work_type: workType.trim() } : {}),
      ...(internalNotes.trim() ? { internal_notes: internalNotes.trim() } : {}),
    }
    await add.mutateAsync(body)
    setOpen(false)
    setTitle('')
    setCharge(false)
    setAmount('')
    setWorkType('')
    setInternalNotes('')
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <Plus /> {label}
        </Button>
      </DialogTrigger>
      <DialogContent title={defaultVisibility === 'client' ? 'Add client deliverable' : 'Add internal work'}>
        <form onSubmit={onSubmit} className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <Label>Title</Label>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} required autoFocus />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>Work type (optional)</Label>
            <Input value={workType} onChange={(e) => setWorkType(e.target.value)} placeholder="e.g. Editing, Album design" />
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={charge} onChange={(e) => setCharge(e.target.checked)} />
            Additional charge
          </label>
          {charge && (
            <div className="flex flex-col gap-1.5">
              <Label>Amount (₹)</Label>
              <Input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
            </div>
          )}
          <div className="flex flex-col gap-1.5">
            <Label>Internal notes (optional)</Label>
            <textarea
              value={internalNotes}
              onChange={(e) => setInternalNotes(e.target.value)}
              rows={2}
              placeholder="Never shown to the client"
              className="w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm"
            />
          </div>
          <div className="flex justify-end gap-2">
            <DialogClose asChild>
              <Button type="button" variant="outline">
                Cancel
              </Button>
            </DialogClose>
            <Button type="submit" disabled={add.isPending}>
              {add.isPending ? 'Adding…' : 'Add'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function EditDeliverableDialog({ id, deliverable }: { id: string; deliverable: Deliverable }) {
  const update = useUpdateDeliverable(id)
  const [open, setOpen] = useState(false)
  const [title, setTitle] = useState(deliverable.title)
  const [charge, setCharge] = useState(deliverable.is_additional_charge)
  const [amount, setAmount] = useState(String(deliverable.additional_charge_amount ?? ''))
  const [showOnQuotation, setShowOnQuotation] = useState(deliverable.show_on_quotation)
  const [workType, setWorkType] = useState(deliverable.work_type ?? '')
  const [internalNotes, setInternalNotes] = useState(deliverable.internal_notes ?? '')

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    await update.mutateAsync({
      deliverableId: deliverable.id,
      patch: {
        title: title.trim(),
        is_additional_charge: charge,
        additional_charge_amount: charge ? Number(amount) || 0 : 0,
        show_on_quotation: showOnQuotation,
        work_type: workType.trim() || null,
        internal_notes: internalNotes.trim() || null,
      },
    })
    setOpen(false)
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="icon" title="Edit">
          <Pencil />
        </Button>
      </DialogTrigger>
      <DialogContent title="Edit deliverable">
        <form onSubmit={onSubmit} className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <Label>Title</Label>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} required autoFocus />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>Work type (optional)</Label>
            <Input value={workType} onChange={(e) => setWorkType(e.target.value)} placeholder="e.g. Editing, Album design" />
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={charge} onChange={(e) => setCharge(e.target.checked)} />
            Additional charge
          </label>
          {charge && (
            <div className="flex flex-col gap-1.5">
              <Label>Amount (₹)</Label>
              <Input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
            </div>
          )}
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={showOnQuotation} onChange={(e) => setShowOnQuotation(e.target.checked)} />
            Show on quotation
          </label>
          <div className="flex flex-col gap-1.5">
            <Label>Internal notes (optional)</Label>
            <textarea
              value={internalNotes}
              onChange={(e) => setInternalNotes(e.target.value)}
              rows={2}
              placeholder="Never shown to the client"
              className="w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm"
            />
          </div>
          <div className="flex justify-end gap-2">
            <DialogClose asChild>
              <Button type="button" variant="outline">
                Cancel
              </Button>
            </DialogClose>
            <Button type="submit" disabled={update.isPending}>
              {update.isPending ? 'Saving…' : 'Save changes'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function AddPaymentDialog({ id, balance }: { id: string; balance: number }) {
  const add = useAddPayment(id)
  const [open, setOpen] = useState(false)
  const [amount, setAmount] = useState(String(balance))
  const [mode, setMode] = useState('upi')

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    const body: PaymentInput = { amount: Number(amount) || 0, mode }
    await add.mutateAsync(body)
    setOpen(false)
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <IndianRupee /> Record
        </Button>
      </DialogTrigger>
      <DialogContent title="Record payment" description={`Balance ${formatINR(balance)}`}>
        <form onSubmit={onSubmit} className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <Label>Amount</Label>
            <Input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} autoFocus />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>Mode</Label>
            <Input value={mode} onChange={(e) => setMode(e.target.value)} placeholder="upi / cash / bank" />
          </div>
          <div className="flex justify-end gap-2">
            <DialogClose asChild>
              <Button type="button" variant="outline">
                Cancel
              </Button>
            </DialogClose>
            <Button type="submit" disabled={add.isPending}>
              {add.isPending ? 'Saving…' : 'Record'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
