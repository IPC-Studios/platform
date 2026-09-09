import { useState } from 'react'
import { AuthedPage } from '@/shared/layout/AuthedPage'
import { PageHeader } from '@/shared/layout/page-header'
import { StatCard } from '@/shared/ui/stat-card'
import { Button } from '@/shared/ui/button'
import { Input } from '@/shared/ui/input'
import { Badge } from '@/shared/ui/badge'
import { Dialog, DialogContent } from '@/shared/ui/dialog'
import { Select } from '@/shared/ui/select'
import {
  useTeamPayouts,
  useCreateTeamPayout,
  useUpdateTeamPayout,
  useUpdatePayoutStatus,
  useDeleteTeamPayout,
} from '@/features/team-payouts/api'
import { useDirectory } from '@/features/team/api'
import { type CreateTeamPayoutRequest, type TeamPayout } from '@ipc/contracts'
import { Plus, Trash2, Pencil, DollarSign, Clock, CheckCircle } from 'lucide-react'

const emptyForm = (): CreateTeamPayoutRequest => ({
  user_id: '',
  amount: 0,
  period_start: '',
  period_end: '',
  payment_mode: null,
  reference: null,
  notes: null,
})

function TeamPayoutsContent() {
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [form, setForm] = useState<CreateTeamPayoutRequest>(emptyForm())

  const { data } = useTeamPayouts()
  const { data: members } = useDirectory()
  const createPayout = useCreateTeamPayout()
  const updatePayout = useUpdateTeamPayout()
  const updateStatus = useUpdatePayoutStatus()
  const deletePayout = useDeleteTeamPayout()

  const items = data?.items ?? []
  const summary = data?.summary

  function startEdit(p: TeamPayout) {
    setEditingId(p.id)
    setForm({
      user_id: p.user_id,
      amount: p.amount,
      period_start: p.period_start,
      period_end: p.period_end,
      payment_mode: p.payment_mode,
      reference: p.reference,
      notes: p.notes,
    })
    setDialogOpen(true)
  }

  function openCreate() {
    setEditingId(null)
    setForm(emptyForm())
    setDialogOpen(true)
  }

  function handleSubmit() {
    if (!form.user_id || form.amount <= 0 || !form.period_start || !form.period_end) return
    if (editingId) {
      const { user_id: _user_id, ...patch } = form
      updatePayout.mutate({ id: editingId, patch }, { onSuccess: () => setDialogOpen(false) })
    } else {
      createPayout.mutate(form, { onSuccess: () => setDialogOpen(false) })
    }
  }

  const statusColors = {
    pending: 'bg-yellow-100 text-yellow-800',
    processing: 'bg-blue-100 text-blue-800',
    completed: 'bg-green-100 text-green-800',
    failed: 'bg-red-100 text-red-800',
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Team Payouts"
        description="Manage team settlements and payments"
        actions={
          <Button onClick={openCreate} size="sm">
            <Plus className="mr-1 h-4 w-4" /> New Payout
          </Button>
        }
      />

      {summary && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard label="Total Payouts" value={summary.total_payouts} icon={DollarSign} />
          <StatCard label="Total Amount" value={`₹${summary.total_amount.toLocaleString()}`} icon={DollarSign} />
          <StatCard label="Pending" value={`₹${summary.pending_amount.toLocaleString()}`} icon={Clock} />
          <StatCard label="Completed" value={`₹${summary.completed_amount.toLocaleString()}`} icon={CheckCircle} />
        </div>
      )}

      <div className="space-y-2">
        {items.map((payout) => (
          <div
            key={payout.id}
            className="flex items-center justify-between rounded-lg border bg-card p-4 transition-colors hover:bg-accent/50"
          >
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="font-medium">₹{payout.amount.toLocaleString()}</span>
                <Badge className={statusColors[payout.status]}>{payout.status}</Badge>
              </div>
              <p className="mt-1 text-sm text-muted-foreground">
                {payout.user_name ?? 'Unknown'} · {payout.period_start} to {payout.period_end}
              </p>
              {payout.notes && (
                <p className="mt-1 text-xs text-muted-foreground">{payout.notes}</p>
              )}
            </div>
            <div className="flex items-center gap-1">
              <Select value={payout.status} onChange={(e) => updateStatus.mutate({ id: payout.id, status: e.target.value })} className="w-32">
                <option value="pending">Pending</option>
                <option value="processing">Processing</option>
                <option value="completed">Completed</option>
                <option value="failed">Failed</option>
              </Select>
              {payout.status === 'pending' && (
                <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => startEdit(payout)}>
                  <Pencil className="h-4 w-4" />
                </Button>
              )}
                <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 text-destructive"
                onClick={() => { if (confirm('Delete this payout?')) deletePayout.mutate(payout.id) }}
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          </div>
        ))}
        {items.length === 0 && (
          <div className="py-12 text-center text-muted-foreground">No payouts yet.</div>
        )}
      </div>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent title={editingId ? 'Edit Payout' : 'New Payout'}>
          <div className="space-y-4">
            <div>
              <label className="text-sm font-medium">Team Member</label>
              <Select value={form.user_id} onChange={(e) => setForm({ ...form, user_id: e.target.value })} disabled={!!editingId}>
                <option value="">Select team member</option>
                {members?.map((m) => (
                  <option key={m.user_id} value={m.user_id}>{m.name ?? m.email}</option>
                ))}
              </Select>
            </div>
            <div>
              <label className="text-sm font-medium">Amount (₹)</label>
              <Input
                type="number"
                min="0"
                step="0.01"
                value={form.amount || ''}
                onChange={(e) => setForm({ ...form, amount: Number(e.target.value) })}
                placeholder="0.00"
              />
            </div>
            <div>
              <label className="text-sm font-medium">Period Start</label>
              <Input
                type="date"
                value={form.period_start}
                onChange={(e) => setForm({ ...form, period_start: e.target.value })}
              />
            </div>
            <div>
              <label className="text-sm font-medium">Period End</label>
              <Input
                type="date"
                value={form.period_end}
                onChange={(e) => setForm({ ...form, period_end: e.target.value })}
              />
            </div>
            <div>
              <label className="text-sm font-medium">Payment Mode</label>
              <Input
                value={form.payment_mode ?? ''}
                onChange={(e) => setForm({ ...form, payment_mode: e.target.value || null })}
                placeholder="e.g. Bank Transfer, UPI"
              />
            </div>
            <div>
              <label className="text-sm font-medium">Reference</label>
              <Input
                value={form.reference ?? ''}
                onChange={(e) => setForm({ ...form, reference: e.target.value || null })}
                placeholder="Transaction reference"
              />
            </div>
            <div>
              <label className="text-sm font-medium">Notes</label>
              <Input
                value={form.notes ?? ''}
                onChange={(e) => setForm({ ...form, notes: e.target.value || null })}
                placeholder="Optional notes"
              />
            </div>
          </div>
          <div className="mt-6 flex justify-end gap-2">
            <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button>
            <Button
              onClick={handleSubmit}
              disabled={
                !form.user_id ||
                form.amount <= 0 ||
                !form.period_start ||
                !form.period_end ||
                createPayout.isPending ||
                updatePayout.isPending
              }
            >
              {editingId
                ? updatePayout.isPending
                  ? 'Saving...'
                  : 'Save changes'
                : createPayout.isPending
                  ? 'Creating...'
                  : 'Create Payout'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}

export function TeamPayoutsPage() {
  return (
    <AuthedPage module="team_payouts">
      <TeamPayoutsContent />
    </AuthedPage>
  )
}
