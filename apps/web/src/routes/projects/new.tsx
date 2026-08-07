import { useMemo, useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { Plus, Trash2 } from 'lucide-react'
import { computeProjectTotals, type DeliverableForTotal } from '@ipc/domain'
import type { CreateProjectRequest, DeliverableInput, PaymentInput } from '@ipc/contracts'
import { AuthedPage } from '@/shared/layout/AuthedPage'
import { PageHeader } from '@/shared/layout/page-header'
import { Button } from '@/shared/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/shared/ui/card'
import { Input, Label, Select } from '@/shared/ui/input'
import { formatINR } from '@/shared/ui/format'
import { useClients, useCreateClient } from '@/features/clients/api'
import { useCreateProject } from '@/features/projects/api'

type DeliverableRow = DeliverableInput
type PaymentRow = PaymentInput

const emptyDeliverable = (): DeliverableRow => ({
  title: '',
  list_key: 'primary',
  is_additional_charge: false,
  additional_charge_amount: 0,
  visibility_scope: 'client',
  show_on_quotation: true,
  start_rule: 'whole_project',
})

export function NewProjectPage() {
  return (
    <AuthedPage module="projects">
      <NewProject />
    </AuthedPage>
  )
}

function NewProject() {
  const navigate = useNavigate()
  const { data: clients } = useClients()
  const createClient = useCreateClient()
  const createProject = useCreateProject()

  const [clientId, setClientId] = useState('')
  const [newClientName, setNewClientName] = useState('')
  const [name, setName] = useState('')
  const [packageCost, setPackageCost] = useState(0)
  const [deliverables, setDeliverables] = useState<DeliverableRow[]>([])
  const [payments, setPayments] = useState<PaymentRow[]>([])
  const [error, setError] = useState<string | null>(null)

  const totals = useMemo(
    () => computeProjectTotals(packageCost, deliverables as DeliverableForTotal[]),
    [packageCost, deliverables],
  )
  const received = payments.reduce((s, p) => s + (p.amount || 0), 0)

  function patchDeliverable(i: number, patch: Partial<DeliverableRow>) {
    setDeliverables((ds) => ds.map((d, idx) => (idx === i ? { ...d, ...patch } : d)))
  }

  async function onSubmit() {
    setError(null)
    try {
      let cid = clientId
      if (!cid && newClientName.trim()) {
        const created = await createClient.mutateAsync({ name: newClientName.trim() })
        cid = created.id
      }
      if (!cid) throw new Error('Pick or add a client.')
      if (!name.trim()) throw new Error('Give the project a name.')

      const body: CreateProjectRequest = {
        client_id: cid,
        name: name.trim(),
        package_cost: packageCost,
        status: 'active',
        show_quotation: false,
        deliverables: deliverables.filter((d) => d.title.trim()),
        payments: payments.filter((p) => p.amount > 0),
      }
      const { id } = await createProject.mutateAsync(body)
      await navigate({ to: '/projects/$id', params: { id } })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create the project.')
    }
  }

  return (
    <>
      <PageHeader title="New project" description="Set the package, deliverables and any advance." />

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <Card>
            <CardHeader>
              <CardTitle>Basics</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <Label>Client</Label>
              {clients && clients.length > 0 && (
                <Select value={clientId} onChange={(e) => setClientId(e.target.value)}>
                  <option value="">— Select a client —</option>
                  {clients.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </Select>
              )}
              {!clientId && (
                <Input
                  placeholder="…or type a new client name"
                  value={newClientName}
                  onChange={(e) => setNewClientName(e.target.value)}
                />
              )}
              <Label className="block pt-2">Project name</Label>
              <Input
                placeholder="e.g. Sharma Wedding"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
              <Label className="block pt-2">Package cost (₹)</Label>
              <Input
                type="number"
                min={0}
                value={packageCost}
                onChange={(e) => setPackageCost(Number(e.target.value))}
              />
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex-row items-center justify-between">
              <CardTitle>Deliverables</CardTitle>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setDeliverables((d) => [...d, emptyDeliverable()])}
              >
                <Plus /> Add
              </Button>
            </CardHeader>
            <CardContent className="space-y-2">
              {deliverables.length === 0 && (
                <p className="text-sm text-muted-foreground">No deliverables yet.</p>
              )}
              {deliverables.map((d, i) => (
                <div key={i} className="flex flex-wrap items-center gap-2 rounded-md border border-border p-2">
                  <Input
                    placeholder="Title"
                    value={d.title}
                    onChange={(e) => patchDeliverable(i, { title: e.target.value })}
                    className="min-w-40 flex-1"
                  />
                  <label className="flex items-center gap-1 text-sm">
                    <input
                      type="checkbox"
                      checked={d.is_additional_charge}
                      onChange={(e) => patchDeliverable(i, { is_additional_charge: e.target.checked })}
                    />
                    Charge
                  </label>
                  <Input
                    type="number"
                    min={0}
                    disabled={!d.is_additional_charge}
                    value={d.additional_charge_amount}
                    onChange={(e) => patchDeliverable(i, { additional_charge_amount: Number(e.target.value) })}
                    className="w-28"
                  />
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => setDeliverables((ds) => ds.filter((_, idx) => idx !== i))}
                  >
                    <Trash2 />
                  </Button>
                </div>
              ))}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex-row items-center justify-between">
              <CardTitle>Advance payments</CardTitle>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setPayments((p) => [...p, { amount: 0 }])}
              >
                <Plus /> Add
              </Button>
            </CardHeader>
            <CardContent className="space-y-2">
              {payments.length === 0 && <p className="text-sm text-muted-foreground">None recorded.</p>}
              {payments.map((p, i) => (
                <div key={i} className="flex items-center gap-2">
                  <Input
                    type="number"
                    min={0}
                    placeholder="Amount"
                    value={p.amount}
                    onChange={(e) =>
                      setPayments((ps) => ps.map((x, idx) => (idx === i ? { ...x, amount: Number(e.target.value) } : x)))
                    }
                    className="w-40"
                  />
                  <Input
                    placeholder="Mode (upi/cash)"
                    value={p.mode ?? ''}
                    onChange={(e) =>
                      setPayments((ps) => ps.map((x, idx) => (idx === i ? { ...x, mode: e.target.value } : x)))
                    }
                    className="flex-1"
                  />
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => setPayments((ps) => ps.filter((_, idx) => idx !== i))}
                  >
                    <Trash2 />
                  </Button>
                </div>
              ))}
            </CardContent>
          </Card>
        </div>

        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Summary</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              <Row label="Package" value={formatINR(packageCost)} />
              <Row label="Additional deliverables" value={formatINR(totals.additional_deliverables_cost)} />
              <div className="my-2 border-t border-border" />
              <Row label="Total" value={formatINR(totals.total_cost)} strong />
              <Row label="Received" value={formatINR(received)} />
              <Row label="Balance" value={formatINR(Math.max(0, totals.total_cost - received))} />
            </CardContent>
          </Card>

          {error && <p className="text-sm text-destructive">{error}</p>}
          <Button
            className="w-full"
            disabled={createProject.isPending || createClient.isPending}
            onClick={() => void onSubmit()}
          >
            {createProject.isPending ? 'Creating…' : 'Create project'}
          </Button>
        </div>
      </div>
    </>
  )
}

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-muted-foreground">{label}</span>
      <span className={strong ? 'text-base font-semibold' : 'font-medium'}>{value}</span>
    </div>
  )
}
