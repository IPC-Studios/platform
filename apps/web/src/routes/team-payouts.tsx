import { useState, type FormEvent } from 'react'
import { AuthedPage } from '@/shared/layout/AuthedPage'
import { PageHeader } from '@/shared/layout/page-header'
import { StatCard } from '@/shared/ui/stat-card'
import { Button } from '@/shared/ui/button'
import { Input, Label } from '@/shared/ui/input'
import { Badge } from '@/shared/ui/badge'
import { StatusBadge } from '@/shared/ui/status-badge'
import { Dialog, DialogClose, DialogContent, DialogTrigger } from '@/shared/ui/dialog'
import { Select } from '@/shared/ui/select'
import { ApiError } from '@/shared/api/client'
import {
  useTeamPayouts,
  useCreateTeamPayout,
  useUpdateTeamPayout,
  useUpdatePayoutStatus,
  useDeleteTeamPayout,
  usePayoutSettlements,
  useCreatePayoutSettlement,
} from '@/features/team-payouts/api'
import { useSlots } from '@/features/allocation/api'
import { useDirectory } from '@/features/team/api'
import { PaymentModePicker } from '@/features/settings/PaymentModePicker'
import { formatINR } from '@/shared/ui/format'
import { type CreateTeamPayoutRequest, type PayoutEntryType, type TeamPayout, type TeamSlot } from '@ipc/contracts'
import { Plus, Trash2, Pencil, DollarSign, Clock, CheckCircle, History, Wallet } from 'lucide-react'

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
  const [tab, setTab] = useState<'manual' | 'shoots'>('manual')
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
          tab === 'manual' && (
            <Button onClick={openCreate} size="sm">
              <Plus className="mr-1 h-4 w-4" /> New Payout
            </Button>
          )
        }
      />

      <div className="flex gap-2 border-b border-border">
        <button
          type="button"
          onClick={() => setTab('manual')}
          className={`border-b-2 px-3 py-2 text-sm font-medium ${tab === 'manual' ? 'border-primary text-foreground' : 'border-transparent text-muted-foreground'}`}
        >
          Manual payouts
        </button>
        <button
          type="button"
          onClick={() => setTab('shoots')}
          className={`border-b-2 px-3 py-2 text-sm font-medium ${tab === 'shoots' ? 'border-primary text-foreground' : 'border-transparent text-muted-foreground'}`}
        >
          From shoots
        </button>
      </div>

      {tab === 'shoots' && <ShootPayoutsTracker />}
      {tab === 'manual' && (
        <>

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
            <PaymentModePicker
              label="Payment Mode"
              value={form.payment_mode ?? ''}
              onChange={(v) => setForm({ ...form, payment_mode: v || null })}
            />
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
        </>
      )}
    </div>
  )
}

const COST_STATUS_TONE = { not_decided: 'neutral', tentative: 'warning', final: 'success' } as const
const SETTLEMENT_TONE = { unpaid: 'danger', partially_paid: 'warning', paid: 'success' } as const

/** Grouped by member: what a shoot-day booking is worth, and what's actually been paid toward it. */
function ShootPayoutsTracker() {
  const { data: slots, isLoading } = useSlots()
  const costed = (slots ?? []).filter((s) => s.status !== 'cancelled' && s.cost_status !== 'not_decided')
  const slotIds = costed.map((s) => s.id)
  const { data: settlements } = usePayoutSettlements(slotIds)
  const paidBySlot = new Map((settlements?.aggregates ?? []).map((a) => [a.slot_id, a]))

  if (isLoading) return <div className="py-12 text-center text-muted-foreground">Loading…</div>
  if (costed.length === 0) {
    return (
      <div className="py-12 text-center text-muted-foreground">
        No priced bookings yet. Set a cost on a booking in Team Allocation to see it here.
      </div>
    )
  }

  const byMember = new Map<string, TeamSlot[]>()
  for (const s of costed) {
    const list = byMember.get(s.user_id) ?? []
    list.push(s)
    byMember.set(s.user_id, list)
  }

  return (
    <div className="space-y-6">
      {[...byMember.entries()].map(([userId, slots]) => {
        const memberTotal = slots.reduce((n, s) => n + (s.final_cost ?? s.estimated_cost ?? 0), 0)
        const memberPaid = slots.reduce((n, s) => n + (paidBySlot.get(s.id)?.paid_total ?? 0), 0)
        return (
          <div key={userId} className="space-y-2">
            <div className="flex items-baseline justify-between">
              <h3 className="font-semibold">{slots[0]!.user_name ?? 'Member'}</h3>
              <p className="text-sm text-muted-foreground">
                {formatINR(memberPaid)} of {formatINR(memberTotal)} paid
              </p>
            </div>
            {slots.map((s) => (
              <SlotPayoutRow key={s.id} slot={s} agg={paidBySlot.get(s.id)} entries={settlements?.entries ?? []} />
            ))}
          </div>
        )
      })}
    </div>
  )
}

function SlotPayoutRow({
  slot,
  agg,
  entries,
}: {
  slot: TeamSlot
  agg: { paid_total: number } | undefined
  entries: readonly { id: string; slot_id: string; entry_type: string; amount_paid: number; paid_date: string; payment_mode: string | null; payment_reference: string | null; notes: string | null }[]
}) {
  const [historyOpen, setHistoryOpen] = useState(false)
  const due = slot.final_cost ?? slot.estimated_cost ?? 0
  const paid = agg?.paid_total ?? 0
  const pending = Math.max(0, due - paid)
  const settlementStatus = pending <= 0.001 ? 'paid' : paid > 0 ? 'partially_paid' : 'unpaid'
  const mine = entries.filter((e) => e.slot_id === slot.id)

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-card p-3">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="font-medium">{slot.service_name ?? 'Booking'}</span>
          <StatusBadge tone={COST_STATUS_TONE[slot.cost_status]}>{slot.cost_status.replace('_', ' ')}</StatusBadge>
          <StatusBadge tone={SETTLEMENT_TONE[settlementStatus]}>{settlementStatus.replace('_', ' ')}</StatusBadge>
        </div>
        <p className="mt-1 text-sm text-muted-foreground">
          {new Date(slot.start_at).toLocaleDateString()} · {formatINR(due)} due, {formatINR(paid)} paid
        </p>
        {slot.cost_notes && <p className="mt-1 text-xs text-muted-foreground">{slot.cost_notes}</p>}
      </div>
      <div className="flex items-center gap-1">
        <Button variant="ghost" size="icon" className="h-8 w-8" title="History" onClick={() => setHistoryOpen(true)} disabled={mine.length === 0}>
          <History className="h-4 w-4" />
        </Button>
        {pending > 0.001 && <MarkPaidDialog slot={slot} pending={pending} />}
      </div>

      <Dialog open={historyOpen} onOpenChange={setHistoryOpen}>
        <DialogContent title="Settlement history" description={slot.service_name ?? undefined}>
          <div className="flex flex-col gap-2">
            {mine.map((e) => (
              <div key={e.id} className="flex items-center justify-between rounded-md border p-2 text-sm">
                <div>
                  <p className="font-medium capitalize">{e.entry_type}</p>
                  <p className="text-xs text-muted-foreground">
                    {e.paid_date}
                    {e.payment_mode ? ` · ${e.payment_mode}` : ''}
                    {e.payment_reference ? ` · ${e.payment_reference}` : ''}
                  </p>
                  {e.notes && <p className="text-xs text-muted-foreground">{e.notes}</p>}
                </div>
                <span className={e.amount_paid < 0 ? 'text-destructive' : 'text-success'}>{formatINR(e.amount_paid)}</span>
              </div>
            ))}
            {mine.length === 0 && <p className="text-sm text-muted-foreground">No entries yet.</p>}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}

/** Amount defaults to the outstanding balance, but stays editable -- a partial payment is the norm, not an edge case. */
function MarkPaidDialog({ slot, pending }: { slot: TeamSlot; pending: number }) {
  const create = useCreatePayoutSettlement()
  const [open, setOpen] = useState(false)
  const [amount, setAmount] = useState(String(pending))
  const [paidOn, setPaidOn] = useState(new Date().toISOString().slice(0, 10))
  const [mode, setMode] = useState('')
  const [reference, setReference] = useState('')
  const [notes, setNotes] = useState('')
  const [entryType, setEntryType] = useState<PayoutEntryType>('payment')
  const [error, setError] = useState<string | null>(null)

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    const value = Number(amount)
    if (!(value > 0)) return
    try {
      await create.mutateAsync({
        slot_id: slot.id,
        amount_paid: value,
        paid_date: paidOn,
        payment_mode: mode || undefined,
        payment_reference: reference.trim() || undefined,
        notes: notes.trim() || undefined,
        entry_type: entryType,
      })
      setOpen(false)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'We could not record this settlement.')
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm">
          <Wallet className="mr-1 h-4 w-4" /> Mark paid
        </Button>
      </DialogTrigger>
      <DialogContent title="Record a settlement" description={`Outstanding: ${formatINR(pending)}`}>
        <form onSubmit={onSubmit} className="flex flex-col gap-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <Label>Amount (₹)</Label>
              <Input type="number" min={0} step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} autoFocus />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>Date</Label>
              <Input type="date" value={paidOn} onChange={(e) => setPaidOn(e.target.value)} />
            </div>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>Type</Label>
            <Select value={entryType} onChange={(e) => setEntryType(e.target.value as PayoutEntryType)}>
              <option value="payment">Payment</option>
              <option value="reversal">Reversal (correct an overpayment)</option>
              <option value="adjustment">Adjustment</option>
            </Select>
          </div>
          <PaymentModePicker value={mode} onChange={setMode} />
          <div className="flex flex-col gap-1.5">
            <Label>Reference</Label>
            <Input value={reference} onChange={(e) => setReference(e.target.value)} placeholder="UTR / cheque no." />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>Notes</Label>
            <Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Optional" />
          </div>
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          <div className="flex justify-end gap-2">
            <DialogClose asChild>
              <Button type="button" variant="outline">
                Cancel
              </Button>
            </DialogClose>
            <Button type="submit" disabled={create.isPending || !(Number(amount) > 0)}>
              {create.isPending ? 'Saving…' : 'Save'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}

export function TeamPayoutsPage() {
  return (
    <AuthedPage module="team_payouts">
      <TeamPayoutsContent />
    </AuthedPage>
  )
}
