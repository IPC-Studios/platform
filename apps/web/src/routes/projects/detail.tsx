import { useState, type FormEvent } from 'react'
import { Link, useParams } from '@tanstack/react-router'
import { Pencil, Plus, Trash2, IndianRupee } from 'lucide-react'
import type {
  DeliverableInput,
  PaymentInput,
  ProjectStatus,
  UpdateProjectRequest,
} from '@ipc/contracts'
import { AuthedPage } from '@/shared/layout/AuthedPage'
import { PageHeader } from '@/shared/layout/page-header'
import { Breadcrumbs } from '@/shared/layout/breadcrumbs'
import { useAccess } from '@/shared/auth/useAccess'
import { useConfirm } from '@/shared/ui/confirm'
import { Card, CardContent, CardHeader, CardTitle } from '@/shared/ui/card'
import { StatCard } from '@/shared/ui/stat-card'
import { StatusBadge } from '@/shared/ui/status-badge'
import { LoadingState, ErrorState, EmptyState } from '@/shared/ui/states'
import { Button } from '@/shared/ui/button'
import { Dialog, DialogClose, DialogContent, DialogTrigger } from '@/shared/ui/dialog'
import { Input, Label, Select } from '@/shared/ui/input'
import { formatINR, humanize } from '@/shared/ui/format'
import {
  useProject,
  useUpdateProject,
  useAddDeliverable,
  useDeleteDeliverable,
  useAddPayment,
} from '@/features/projects/api'

export function ProjectDetailPage() {
  return (
    <AuthedPage module="projects">
      <ProjectDetail />
    </AuthedPage>
  )
}

function ProjectDetail() {
  const { id } = useParams({ from: '/projects/$id' })
  const { data, isLoading, isError, refetch } = useProject(id)
  const access = useAccess()
  const canEdit = access.hasAction('projects', 'edit')
  const del = useDeleteDeliverable(id)
  const confirm = useConfirm()

  if (isLoading) return <LoadingState />
  if (isError || !data) return <ErrorState onRetry={() => void refetch()} />

  const received = data.payments.reduce((s, p) => s + p.amount, 0)
  const balance = Math.max(0, data.total_cost - received)

  async function removeDeliverable(dId: string, title: string) {
    if (await confirm({ title: `Remove "${title}"?`, destructive: true, confirmLabel: 'Remove' })) {
      del.mutate(dId)
    }
  }

  return (
    <>
      <Breadcrumbs items={[{ label: 'Projects', to: '/projects' }, { label: data.name }]} />
      <PageHeader
        title={data.name}
        actions={
          <div className="flex items-center gap-2">
            <StatusBadge tone="info">{humanize(data.status)}</StatusBadge>
            {canEdit && <EditProjectDialog id={id} name={data.name} status={data.status} packageCost={data.package_cost} />}
          </div>
        }
      />

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="Total" value={formatINR(data.total_cost)} />
        <StatCard label="Package" value={formatINR(data.package_cost)} />
        <StatCard label="Received" value={formatINR(received)} />
        <StatCard label="Balance" value={formatINR(balance)} />
      </div>

      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader className="flex-row items-center justify-between">
            <CardTitle>Deliverables</CardTitle>
            {canEdit && <AddDeliverableDialog id={id} />}
          </CardHeader>
          <CardContent>
            {data.deliverables.length === 0 ? (
              <EmptyState title="No deliverables" />
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

        <Card>
          <CardHeader className="flex-row items-center justify-between">
            <CardTitle>Payments</CardTitle>
            {canEdit && <AddPaymentDialog id={id} balance={balance} />}
          </CardHeader>
          <CardContent>
            {data.payments.length === 0 ? (
              <EmptyState title="No payments yet" />
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

      <div className="mt-6">
        <Button asChild variant="outline">
          <Link to="/projects">Back to projects</Link>
        </Button>
      </div>
    </>
  )
}

function EditProjectDialog({
  id,
  name,
  status,
  packageCost,
}: {
  id: string
  name: string
  status: ProjectStatus
  packageCost: number
}) {
  const update = useUpdateProject(id)
  const [open, setOpen] = useState(false)
  const [form, setForm] = useState<UpdateProjectRequest>({ name, status, package_cost: packageCost })

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
