import { useState } from 'react'
import { FlaskConical, RotateCw, Search } from 'lucide-react'
import type { FbImportStatus } from '@ipc/contracts'
import { Button } from '@/shared/ui/button'
import { Card, CardContent } from '@/shared/ui/card'
import { Dialog, DialogContent } from '@/shared/ui/dialog'
import { Input, Label, Select } from '@/shared/ui/input'
import { SkeletonCards } from '@/shared/ui/skeleton'
import { StatCard } from '@/shared/ui/stat-card'
import { StatusBadge } from '@/shared/ui/status-badge'
import { EmptyState, ErrorState } from '@/shared/ui/states'
import { useAccess } from '@/shared/auth/useAccess'
import { useCreateTestLead, useImportLog, useRetryImport, type ImportLogFilters } from './api'

const TONE: Record<FbImportStatus, 'success' | 'neutral' | 'danger' | 'warning'> = {
  imported: 'success',
  duplicate: 'neutral',
  failed: 'danger',
  pending: 'warning',
}

const stamp = new Intl.DateTimeFormat('en-IN', {
  day: 'numeric',
  month: 'short',
  hour: 'numeric',
  minute: '2-digit',
})

/**
 * Every lead that arrived through one source, and what happened to it.
 *
 * "Did the form work" is the question this answers, which is why a duplicate is
 * shown as its own outcome rather than hidden: a studio chasing a lead that
 * never appeared needs to see that it did arrive and was deduped.
 */
export function ImportLogPanel({ sourceId, sourceLabel }: { sourceId: string; sourceLabel: string }) {
  const [filters, setFilters] = useState<ImportLogFilters>({ sort: 'newest' })
  const [testOpen, setTestOpen] = useState(false)
  const { data, isLoading, isError, refetch } = useImportLog(sourceId, filters)
  const retry = useRetryImport(sourceId)
  const access = useAccess()
  const canEdit = access.hasAction('crm', 'edit')

  const set = (patch: Partial<ImportLogFilters>) => setFilters((f) => ({ ...f, ...patch }))
  const s = data?.summary

  return (
    <div className="mt-4 flex flex-col gap-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <StatCard label="Arrived" value={s?.total ?? 0} />
        <StatCard label="Imported" value={s?.imported ?? 0} />
        <StatCard label="Duplicates" value={s?.duplicates ?? 0} />
        <StatCard label="Failed" value={s?.failed ?? 0} />
        <StatCard label="Pending" value={s?.pending ?? 0} />
      </div>

      <Card>
        <CardContent className="grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-5">
          <div className="flex flex-col gap-1.5 lg:col-span-2">
            <Label htmlFor={`imp-search-${sourceId}`}>Search</Label>
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                id={`imp-search-${sourceId}`}
                className="pl-8"
                value={filters.search ?? ''}
                onChange={(e) => set({ search: e.target.value })}
                placeholder="Name, phone or email"
              />
            </div>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>Outcome</Label>
            <Select value={filters.status ?? ''} onChange={(e) => set({ status: e.target.value })}>
              <option value="">Any</option>
              <option value="imported">Imported</option>
              <option value="duplicate">Duplicate</option>
              <option value="failed">Failed</option>
              <option value="pending">Pending</option>
            </Select>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>From</Label>
            <Input type="date" value={filters.dateFrom ?? ''} onChange={(e) => set({ dateFrom: e.target.value })} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>To</Label>
            <Input type="date" value={filters.dateTo ?? ''} onChange={(e) => set({ dateTo: e.target.value })} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>Order</Label>
            <Select
              value={filters.sort ?? 'newest'}
              onChange={(e) => set({ sort: e.target.value as 'newest' | 'oldest' })}
            >
              <option value="newest">Newest first</option>
              <option value="oldest">Oldest first</option>
            </Select>
          </div>
          <div className="flex items-end gap-2 sm:col-span-2 lg:col-span-4">
            <Button size="sm" variant="ghost" onClick={() => setFilters({ sort: 'newest' })}>
              Clear filters
            </Button>
            {canEdit && (
              <Button size="sm" variant="outline" onClick={() => setTestOpen(true)}>
                <FlaskConical /> Send a test lead
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      {isLoading ? (
        <SkeletonCards count={3} />
      ) : isError ? (
        <ErrorState onRetry={() => void refetch()} />
      ) : !data || data.items.length === 0 ? (
        <Card>
          <CardContent className="py-4">
            <EmptyState
              title="Nothing has arrived yet"
              description={`No leads have come through ${sourceLabel}. Send a test lead to check the wiring end to end.`}
            />
          </CardContent>
        </Card>
      ) : (
        <ul className="flex flex-col gap-2">
          {data.items.map((row) => (
            <li key={row.id} className="rounded-lg border border-border bg-card p-3">
              <div className="flex flex-wrap items-center gap-3">
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">{row.name ?? row.phone ?? 'Unnamed lead'}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    {[row.phone, row.email].filter(Boolean).join(' · ') || 'No contact details'}
                    {row.page_name ? ` · ${row.page_name}` : ''} · {stamp.format(new Date(row.created_at))}
                  </p>
                  {row.error && <p className="mt-0.5 text-xs text-destructive">{row.error}</p>}
                </div>
                <StatusBadge tone={TONE[row.status]}>{row.status}</StatusBadge>
                {canEdit && row.status === 'failed' && (
                  <Button size="sm" variant="outline" disabled={retry.isPending} onClick={() => retry.mutate(row.id)}>
                    <RotateCw /> Retry
                  </Button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

      {testOpen && <TestLeadDialog sourceId={sourceId} onClose={() => setTestOpen(false)} />}
    </div>
  )
}

/**
 * Pushes a sample lead through the source's own webhook path — the same code a
 * real Meta lead takes — so a studio can prove the wiring before the first ad
 * goes live.
 */
function TestLeadDialog({ sourceId, onClose }: { sourceId: string; onClose: () => void }) {
  const create = useCreateTestLead(sourceId)
  const [name, setName] = useState('Test Lead')
  const [phone, setPhone] = useState('')
  const [email, setEmail] = useState('')

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent
        title="Send a test lead"
        description="Creates a real lead through this source so you can see it land in the inbox."
      >
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="tl-name">Name</Label>
            <Input id="tl-name" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="tl-phone">Phone *</Label>
            <Input
              id="tl-phone"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="10 digits, or with a country code"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="tl-email">Email</Label>
            <Input id="tl-email" value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
          <p className="text-xs text-muted-foreground">
            This creates a genuine lead, not a simulation — delete it from the inbox afterwards.
          </p>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button
              disabled={phone.trim().length < 6 || create.isPending}
              onClick={() =>
                create
                  .mutateAsync({
                    name: name.trim() || undefined,
                    phone: phone.trim(),
                    email: email.trim() || undefined,
                  })
                  .then(onClose, () => undefined)
              }
            >
              {create.isPending ? 'Sending…' : 'Send test lead'}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
