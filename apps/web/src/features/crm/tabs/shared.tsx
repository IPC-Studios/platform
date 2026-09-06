import type { ReactNode } from 'react'
import { Archive, Flame } from 'lucide-react'
import type { CrmLead, LeadStatus } from '@ipc/contracts'
import { Card, CardContent } from '@/shared/ui/card'
import { StatusBadge } from '@/shared/ui/status-badge'
import { EmptyState } from '@/shared/ui/states'
import { Avatar } from '@/shared/ui/avatar'
import { useIsMobile } from '@/shared/hooks/use-mobile'
import { STAGE_LABEL, dueBucket } from '../leads'

export const SOURCE_TONE: Record<string, 'info' | 'success' | 'warning' | 'neutral'> = {
  facebook: 'info',
  webform: 'neutral',
  referral: 'success',
  manual: 'neutral',
  enquiry: 'warning',
}

export const STAGE_TONE: Record<LeadStatus, 'info' | 'success' | 'warning' | 'neutral' | 'danger'> = {
  new: 'info',
  contacted: 'neutral',
  qualified: 'warning',
  proposal_sent: 'warning',
  converted: 'success',
  lost: 'danger',
}

const dayFormat = new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short' })
export const prettyDate = (iso: string) => dayFormat.format(new Date(iso))

/** Today's date as the API wants it. */
export const isoDay = (d: Date) => d.toISOString().slice(0, 10)

export function DueBadge({ lead, now }: { lead: CrmLead; now: Date }) {
  const bucket = dueBucket(lead, now)
  if (bucket === 'none') {
    return <span className="text-xs text-muted-foreground">No follow-up</span>
  }
  const tone = bucket === 'overdue' ? 'danger' : bucket === 'today' ? 'warning' : 'neutral'
  const label =
    bucket === 'overdue'
      ? `Overdue · ${prettyDate(lead.follow_up_at!)}`
      : bucket === 'today'
        ? 'Due today'
        : prettyDate(lead.follow_up_at!)
  return <StatusBadge tone={tone}>{label}</StatusBadge>
}

export function LeadTable({
  leads,
  now,
  total,
  onOpen,
  selected,
  onToggleSelect,
  onToggleAll,
}: {
  leads: readonly CrmLead[]
  now: Date
  total: number
  onOpen: (id: string) => void
  selected?: Set<string>
  onToggleSelect?: (id: string, on: boolean) => void
  onToggleAll?: (on: boolean) => void
}) {
  const isMobile = useIsMobile()

  if (leads.length === 0) {
    return (
      <Card>
        <CardContent className="py-4">
          <EmptyState
            title={total === 0 ? 'No leads yet.' : 'No leads match these filters.'}
            description={
              total === 0
                ? 'Add one by hand, or connect a web form so they arrive on their own.'
                : 'Clear a filter or two to widen the list.'
            }
          />
        </CardContent>
      </Card>
    )
  }

  if (isMobile) {
    return (
      <div className="flex flex-col gap-3">
        {leads.map((l) => (
          <button
            key={l.id}
            type="button"
            onClick={() => onOpen(l.id)}
            className="rounded-lg border border-border bg-card p-4 text-left"
          >
            <div className="flex items-start justify-between gap-2">
              <p className="truncate font-medium">{l.name ?? l.phone ?? 'Unnamed lead'}</p>
              <StatusBadge tone={STAGE_TONE[l.status]}>{STAGE_LABEL[l.status]}</StatusBadge>
            </div>
            <p className="mt-1 truncate text-sm text-muted-foreground">{l.phone ?? '—'}</p>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              {l.is_hot && (
                <StatusBadge tone="danger">
                  <Flame className="mr-1 size-3" /> Hot
                </StatusBadge>
              )}
              {l.is_archived && (
                <StatusBadge tone="neutral">
                  <Archive className="mr-1 size-3" /> Archived
                </StatusBadge>
              )}
              <DueBadge lead={l} now={now} />
            </div>
          </button>
        ))}
      </div>
    )
  }

  const allChecked = selected ? leads.length > 0 && leads.every((l) => selected.has(l.id)) : false
  return (
    <div className="table-wrap rounded-lg border border-border">
      <table className="table-sticky w-full text-sm">
        <thead className="bg-muted/50 text-left text-muted-foreground">
          <tr>
            {selected && onToggleAll && (
              <th className="px-2 py-2">
                <input type="checkbox" checked={allChecked} onChange={(e) => onToggleAll(e.target.checked)} aria-label="Select all" />
              </th>
            )}
            <th className="min-w-48 px-4 py-2 font-medium">Lead</th>
            <th className="px-4 py-2 font-medium">Stage</th>
            <th className="px-4 py-2 font-medium">Source</th>
            <th className="px-4 py-2 font-medium">Owner</th>
            <th className="px-4 py-2 font-medium">Follow-up</th>
          </tr>
        </thead>
        <tbody>
          {leads.map((l) => (
            <tr
              key={l.id}
              onClick={() => onOpen(l.id)}
              className={`cursor-pointer border-t border-border hover:bg-muted/30 ${l.is_archived ? 'opacity-60' : ''}`}
            >
              {selected && onToggleSelect && (
                <td className="px-2 py-2" onClick={(e) => e.stopPropagation()}>
                  <input
                    type="checkbox"
                    checked={selected.has(l.id)}
                    onChange={(e) => onToggleSelect(l.id, e.target.checked)}
                    aria-label={`Select ${l.name ?? l.phone ?? 'lead'}`}
                  />
                </td>
              )}
              <td className="px-4 py-2">
                <span className="flex items-center gap-2 font-medium">
                  {l.is_hot && <Flame className="size-3.5 shrink-0 text-destructive" aria-label="Hot" />}
                  {l.is_archived && <Archive className="size-3.5 shrink-0 text-muted-foreground" aria-label="Archived" />}
                  {l.name ?? 'Unnamed lead'}
                </span>
                <span className="text-xs text-muted-foreground">{l.phone ?? '—'}</span>
              </td>
              <td className="px-4 py-2">
                <StatusBadge tone={STAGE_TONE[l.status]}>{STAGE_LABEL[l.status]}</StatusBadge>
              </td>
              <td className="px-4 py-2">
                <StatusBadge tone={SOURCE_TONE[l.source] ?? 'neutral'}>{l.source}</StatusBadge>
              </td>
              <td className="px-4 py-2 text-muted-foreground">
                {l.assignee_name ? (
                  <span className="flex items-center gap-2">
                    <Avatar name={l.assignee_name} size="sm" />
                    <span className="truncate">{l.assignee_name}</span>
                  </span>
                ) : (
                  <span className="text-warning">Unassigned</span>
                )}
              </td>
              <td className="px-4 py-2">
                <DueBadge lead={l} now={now} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export function LeadCard({ lead, onOpen }: { lead: CrmLead; onOpen: (id: string) => void }) {
  return (
    <button
      type="button"
      onClick={() => onOpen(lead.id)}
      className="rounded-lg border border-border bg-card p-3 text-left transition-colors hover:bg-accent"
    >
      <p className="flex items-center gap-1.5 truncate text-sm font-medium">
        {lead.is_hot && <Flame className="size-3 shrink-0 text-destructive" />}
        {lead.name ?? 'Unnamed lead'}
      </p>
      <p className="truncate text-xs text-muted-foreground">{lead.phone ?? '—'}</p>
      <p className="mt-1 truncate text-xs text-muted-foreground">{lead.assignee_name ?? 'Unassigned'}</p>
    </button>
  )
}

export function BoardColumn({
  title,
  hint,
  count,
  tone,
  children,
}: {
  title: string
  hint?: string
  count: number
  tone: 'danger' | 'warning' | 'neutral' | 'info' | 'success'
  children: ReactNode
}) {
  return (
    <div className="rounded-lg border border-border bg-card p-3">
      <div className="flex items-center justify-between gap-2">
        <p className="font-medium">{title}</p>
        <StatusBadge tone={tone}>{count}</StatusBadge>
      </div>
      {hint && <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p>}
      <div className="mt-3 flex flex-col gap-2">
        {count === 0 ? <p className="py-4 text-center text-xs text-muted-foreground">Empty</p> : children}
      </div>
    </div>
  )
}

/** Downloads the given leads as a spreadsheet-friendly CSV. */
export function exportLeadsCsv(leads: readonly CrmLead[], filename = 'leads.csv') {
  const header = 'name,phone,email,status,source,owner,follow_up_at,created_at\n'
  const rows = leads
    .map((l) =>
      [l.name ?? '', l.phone ?? '', l.email ?? '', l.status, l.source, l.assignee_name ?? '', l.follow_up_at ?? '', l.created_at]
        .map((v) => `"${String(v).replace(/"/g, '""')}"`)
        .join(','),
    )
    .join('\n')
  const blob = new Blob([header + rows], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}
