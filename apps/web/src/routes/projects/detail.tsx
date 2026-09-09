import { useState, type FormEvent } from 'react'
import { Link, useNavigate, useParams } from '@tanstack/react-router'
import {
  ArrowRight,
  Briefcase,
  Camera,
  CircleCheck,
  Clock,
  FileText,
  IndianRupee,
  LayoutGrid,
  Package,
  PauseCircle,
  Pencil,
  Phone,
  Plus,
  Trash2,
  Users,
  Wallet,
  X,
} from 'lucide-react'
import type {
  Deliverable,
  DeliverableInput,
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

/** The tabs across a project. Each one is a view of the same project. */
const TABS = [
  { value: 'overview', label: 'Overview', icon: LayoutGrid },
  { value: 'deliverables', label: 'Deliverables', icon: Package },
  { value: 'billing', label: 'Billing', icon: Wallet },
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
  const del = useDeleteDeliverable(id)
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
            <Link to="/shoots">
              <Camera /> Shoots
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
      <div className="mt-4">
        <Card>
          <CardHeader className="flex-row items-center justify-between">
            <CardTitle>Deliverables</CardTitle>
            {canEdit && <AddDeliverableDialog id={id} />}
          </CardHeader>
          <CardContent>
            {data.deliverables.length === 0 ? (
              <EmptyState
                title="No deliverables yet"
                description="List what the client receives — the album, the film, the reel. Chargeable ones add to the project total."
              />
            ) : (
              <ul className="divide-y divide-border">
                {data.deliverables.map((d) => (
                  <li key={d.id} className="flex items-center justify-between py-2">
                    <div>
                      <p className="font-medium">{d.title}</p>
                      <p className="text-xs text-muted-foreground">
                        {d.visibility_scope} · {d.list_key}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      {d.is_additional_charge && (
                        <span className="text-sm font-medium">{formatINR(d.additional_charge_amount)}</span>
                      )}
                      {canEdit && <EditDeliverableDialog id={id} deliverable={d} />}
                      {canEdit && (
                        <Button variant="ghost" size="icon" onClick={() => void removeDeliverable(d.id, d.title)}>
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
                type="number"
                min={0}
                value={form.package_cost ?? 0}
                onChange={(e) => setForm({ ...form, package_cost: Number(e.target.value) })}
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

function AddDeliverableDialog({ id }: { id: string }) {
  const add = useAddDeliverable(id)
  const [open, setOpen] = useState(false)
  const [title, setTitle] = useState('')
  const [charge, setCharge] = useState(false)
  const [amount, setAmount] = useState(0)

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    const body: DeliverableInput = {
      title: title.trim(),
      list_key: 'primary',
      is_additional_charge: charge,
      additional_charge_amount: amount,
      visibility_scope: 'client',
      show_on_quotation: true,
      start_rule: 'whole_project',
    }
    await add.mutateAsync(body)
    setOpen(false)
    setTitle('')
    setCharge(false)
    setAmount(0)
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <Plus /> Add
        </Button>
      </DialogTrigger>
      <DialogContent title="Add deliverable">
        <form onSubmit={onSubmit} className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <Label>Title</Label>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} required autoFocus />
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={charge} onChange={(e) => setCharge(e.target.checked)} />
            Additional charge
          </label>
          {charge && (
            <div className="flex flex-col gap-1.5">
              <Label>Amount (₹)</Label>
              <Input type="number" min={0} value={amount} onChange={(e) => setAmount(Number(e.target.value))} />
            </div>
          )}
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
  const [amount, setAmount] = useState(deliverable.additional_charge_amount)
  const [showOnQuotation, setShowOnQuotation] = useState(deliverable.show_on_quotation)

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    await update.mutateAsync({
      deliverableId: deliverable.id,
      patch: {
        title: title.trim(),
        is_additional_charge: charge,
        additional_charge_amount: amount,
        show_on_quotation: showOnQuotation,
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
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={charge} onChange={(e) => setCharge(e.target.checked)} />
            Additional charge
          </label>
          {charge && (
            <div className="flex flex-col gap-1.5">
              <Label>Amount (₹)</Label>
              <Input type="number" min={0} value={amount} onChange={(e) => setAmount(Number(e.target.value))} />
            </div>
          )}
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={showOnQuotation} onChange={(e) => setShowOnQuotation(e.target.checked)} />
            Show on quotation
          </label>
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
  const [amount, setAmount] = useState(balance)
  const [mode, setMode] = useState('upi')

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    const body: PaymentInput = { amount, mode }
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
            <Input type="number" min={0} value={amount} onChange={(e) => setAmount(Number(e.target.value))} autoFocus />
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
