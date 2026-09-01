import { useMemo, useState, type FormEvent } from 'react'
import { CalendarClock, Plus } from 'lucide-react'
import { findConflicts } from '@ipc/domain'
import type { BookSlotRequest } from '@ipc/contracts'
import { AuthedPage } from '@/shared/layout/AuthedPage'
import { PageHeader } from '@/shared/layout/page-header'
import { Button } from '@/shared/ui/button'
import { SkeletonCards } from '@/shared/ui/skeleton'
import { Card, CardContent } from '@/shared/ui/card'
import { Dialog, DialogClose, DialogContent, DialogTrigger } from '@/shared/ui/dialog'
import { Input, Label, Select } from '@/shared/ui/input'
import { StatusBadge } from '@/shared/ui/status-badge'
import { ErrorState, EmptyState } from '@/shared/ui/states'
import { formatINR } from '@/shared/ui/format'
import { useSlots, useMembers, useBookSlot, ApiError } from '@/features/allocation/api'

export function TeamAllocationPage() {
  return (
    <AuthedPage module="projects">
      <Allocation />
    </AuthedPage>
  )
}

const fmt = (iso: string) =>
  new Date(iso).toLocaleString('en-IN', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  })

function Allocation() {
  const { data, isLoading, isError, refetch } = useSlots()
  const booked = (data ?? []).filter((s) => s.status === 'booked')

  return (
    <>
      <PageHeader
        title="Team allocation"
        description="Book crew into shoots. Double-booking is blocked."
        actions={<BookDialog />}
      />
      {isLoading ? (
        <SkeletonCards count={3} />
      ) : isError ? (
        <ErrorState onRetry={() => void refetch()} />
      ) : booked.length === 0 ? (
        <EmptyState title="No bookings yet" description="Book your crew for upcoming shoots." action={<BookDialog />} />
      ) : (
        <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
          {booked.map((s) => (
            <Card key={s.id}>
              <CardContent className="p-4">
                <div className="flex items-center justify-between">
                  <span className="flex items-center gap-2 font-medium">
                    <CalendarClock className="size-4 text-muted-foreground" />
                    {s.user_name ?? 'Member'}
                  </span>
                  {s.estimated_cost != null && (
                    <StatusBadge tone="info">{formatINR(s.estimated_cost)}</StatusBadge>
                  )}
                </div>
                <p className="mt-2 text-sm">{s.service_name ?? 'Shoot'}</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {fmt(s.start_at)} → {fmt(s.end_at)}
                </p>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </>
  )
}

function BookDialog() {
  const { data: members } = useMembers()
  const { data: slots } = useSlots()
  const book = useBookSlot()
  const [open, setOpen] = useState(false)
  const [userId, setUserId] = useState('')
  const [service, setService] = useState('')
  const [start, setStart] = useState('')
  const [end, setEnd] = useState('')
  const [cost, setCost] = useState(0)
  const [error, setError] = useState<string | null>(null)

  // Live conflict preview against this member's existing booked slots.
  const conflicts = useMemo(() => {
    if (!userId || !start || !end) return []
    const mine = (slots ?? []).filter((s) => s.user_id === userId && s.status === 'booked')
    try {
      return findConflicts(
        { start_at: new Date(start).toISOString(), end_at: new Date(end).toISOString() },
        mine,
      )
    } catch {
      return []
    }
  }, [userId, start, end, slots])

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    try {
      const body: BookSlotRequest = {
        user_id: userId,
        shoot_id: null,
        service_name: service || undefined,
        start_at: new Date(start).toISOString(),
        end_at: new Date(end).toISOString(),
        estimated_cost: cost || undefined,
      }
      await book.mutateAsync(body)
      setOpen(false)
      setUserId('')
      setService('')
      setStart('')
      setEnd('')
      setCost(0)
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : err instanceof Error ? err.message : 'Could not book.',
      )
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <Plus /> Book crew
        </Button>
      </DialogTrigger>
      <DialogContent title="Book crew" description="Reserve a member for a time window.">
        <form onSubmit={onSubmit} className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <Label>Member</Label>
            <Select value={userId} onChange={(e) => setUserId(e.target.value)} required>
              <option value="">— Select —</option>
              {(members ?? []).map((m) => (
                <option key={m.user_id} value={m.user_id}>
                  {m.name}
                </option>
              ))}
            </Select>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>Service</Label>
            <Input value={service} onChange={(e) => setService(e.target.value)} placeholder="Wedding day" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <Label>Start</Label>
              <Input type="datetime-local" value={start} onChange={(e) => setStart(e.target.value)} required />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>End</Label>
              <Input type="datetime-local" value={end} onChange={(e) => setEnd(e.target.value)} required />
            </div>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>Estimated cost (₹)</Label>
            <Input type="number" min={0} value={cost} onChange={(e) => setCost(Number(e.target.value))} />
          </div>

          {conflicts.length > 0 && (
            <p className="rounded-md bg-warning/10 px-3 py-2 text-sm text-warning">
              This member already has {conflicts.length} booking(s) that overlap this window.
            </p>
          )}
          {error && <p className="text-sm text-destructive">{error}</p>}

          <div className="mt-2 flex justify-end gap-2">
            <DialogClose asChild>
              <Button type="button" variant="outline">
                Cancel
              </Button>
            </DialogClose>
            <Button type="submit" disabled={book.isPending || conflicts.length > 0}>
              {book.isPending ? 'Booking…' : 'Book'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
