import { useEffect, useMemo, useRef, useState } from 'react'
import { Bookmark, BookmarkPlus, Download, Pencil, Search, X } from 'lucide-react'
import type { CrmLead, LeadStatus } from '@ipc/contracts'
import { Button } from '@/shared/ui/button'
import { Input, Select } from '@/shared/ui/input'
import { cn } from '@/shared/ui/cn'
import { useAuth } from '@/shared/auth/AuthProvider'
import { useBulkPatch, useDeleteView, useSaveView, useSavedViews, useUpdateView } from '../api'
import { EMPTY_QUERY, QUICK_FILTERS, STAGES, applyQuery, type LeadQuery, type QuickFilter } from '../leads'
import { isSaveable, takeLocalViews, toLeadQuery, toSavedQuery } from '../views'
import { LeadTable, exportLeadsCsv } from './shared'
import { LostReasonDialog } from '../LostReasonDialog'

export function InboxTab({
  leads,
  now,
  query,
  onQuery,
  counts,
  onOpen,
  showArchived,
  onShowArchived,
}: {
  leads: readonly CrmLead[]
  now: Date
  query: LeadQuery
  onQuery: (q: LeadQuery) => void
  counts: Record<QuickFilter, number>
  onOpen: (id: string) => void
  showArchived: boolean
  onShowArchived: (on: boolean) => void
}) {
  const { data: views } = useSavedViews()
  const saveView = useSaveView()
  const updateView = useUpdateView()
  const deleteView = useDeleteView()
  const { session } = useAuth()
  const [naming, setNaming] = useState(false)
  const [viewName, setViewName] = useState('')
  const [viewVisibility, setViewVisibility] = useState<'private' | 'team' | 'everyone'>('private')
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const [dismissed, setDismissed] = useState(false)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [losing, setLosing] = useState(false)
  const bulk = useBulkPatch()

  // Views saved before they lived on the API were in this browser only. Push
  // them up once, so nothing someone set up is lost in the move.
  const migrated = useRef(false)
  useEffect(() => {
    if (migrated.current || !views) return
    migrated.current = true
    for (const v of takeLocalViews()) {
      if (!views.some((s) => s.name === v.name)) saveView.mutate({ name: v.name, query: v.query, visibility: 'private' })
    }
  }, [views, saveView])

  const rows = useMemo(() => applyQuery(leads, query, now), [leads, query, now])
  const assignees = useMemo(() => {
    const seen = new Map<string, string>()
    for (const l of leads) if (l.assigned_to) seen.set(l.assigned_to, l.assignee_name ?? 'Unknown')
    return [...seen.entries()]
  }, [leads])

  const toggleSelect = (id: string, on: boolean) =>
    setSelected((s) => {
      const n = new Set(s)
      if (on) n.add(id)
      else n.delete(id)
      return n
    })
  const toggleAll = (on: boolean) => setSelected(on ? new Set(rows.map((r) => r.id)) : new Set())
  const toggleFilter = (f: QuickFilter) =>
    onQuery({
      ...query,
      filters: query.filters.includes(f) ? query.filters.filter((x) => x !== f) : [...query.filters, f],
    })

  const runBulk = (patch: Parameters<typeof bulk.mutate>[0]['patch']) =>
    bulk.mutate({ ids: [...selected], patch }, { onSuccess: () => setSelected(new Set()) })

  const filtered =
    query.filters.length > 0 || query.search || query.status !== 'all' || query.assignee !== 'all'

  return (
    <div className="flex flex-col gap-4">
      {!dismissed && (
        <div className="flex items-start gap-3 rounded-lg border border-primary/20 bg-primary/[0.04] p-4 text-sm">
          <p className="flex-1 text-muted-foreground">
            <span className="font-medium text-foreground">Lead Inbox.</span> Stack quick filters to
            narrow the list, save the combinations you use daily, and click a row to open the lead.
          </p>
          <button type="button" onClick={() => setDismissed(true)} className="text-muted-foreground hover:text-foreground">
            <X className="size-4" />
            <span className="sr-only">Dismiss</span>
          </button>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <Select
          className="w-48"
          value=""
          aria-label="Saved views"
          onChange={(e) => {
            const view = (views ?? []).find((v) => v.id === e.target.value)
            if (view) onQuery(toLeadQuery(view.query))
          }}
        >
          <option value="">Saved views…</option>
          {(views ?? []).map((v) => (
            <option key={v.id} value={v.id}>
              {v.name}
            </option>
          ))}
        </Select>

        {naming ? (
          <span className="flex flex-wrap items-center gap-2">
            <Input value={viewName} onChange={(e) => setViewName(e.target.value)} placeholder="Name this view" className="w-48" autoFocus aria-label="View name" />
            <Select
              value={viewVisibility}
              onChange={(e) => setViewVisibility(e.target.value as 'private' | 'team' | 'everyone')}
              className="w-36"
              aria-label="Who can see this view"
            >
              <option value="private">Only me</option>
              <option value="team">My team</option>
              <option value="everyone">Everyone</option>
            </Select>
            <Button
              size="sm"
              disabled={!viewName.trim() || saveView.isPending}
              onClick={() =>
                saveView.mutate(
                  { name: viewName.trim(), query: toSavedQuery(query), visibility: viewVisibility },
                  {
                    onSuccess: () => {
                      setViewName('')
                      setViewVisibility('private')
                      setNaming(false)
                    },
                  },
                )
              }
            >
              Save
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setNaming(false)}>
              Cancel
            </Button>
          </span>
        ) : (
          <Button
            variant="outline"
            size="sm"
            disabled={!isSaveable(query)}
            title={isSaveable(query) ? undefined : 'Filter the list first, then save it as a view.'}
            onClick={() => setNaming(true)}
          >
            <BookmarkPlus /> Save current view
          </Button>
        )}

        {(views ?? []).length > 0 && (
          <span className="flex flex-wrap items-center gap-1">
            {(views ?? []).map((v) => {
              // Only the creator (or studio owner) can change a view — the API
              // enforces the same rule, this just avoids offering a dead button.
              const mine = v.user_id === session?.user_id || !!session?.is_owner
              return (
                <span key={v.id} className="flex items-center gap-1 rounded-full border border-border py-1 pl-2.5 pr-1 text-xs">
                  <Bookmark className="size-3" />
                  {renamingId === v.id ? (
                    <span className="flex items-center gap-1">
                      <Input
                        value={renameValue}
                        onChange={(e) => setRenameValue(e.target.value)}
                        className="h-6 w-32 px-1.5 py-0 text-xs"
                        autoFocus
                        aria-label="View name"
                        onKeyDown={(e) => {
                          if (e.key === 'Escape') setRenamingId(null)
                        }}
                      />
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-6 px-1.5 text-xs"
                        disabled={!renameValue.trim() || updateView.isPending}
                        onClick={() =>
                          updateView.mutate(
                            { id: v.id, patch: { name: renameValue.trim() } },
                            { onSuccess: () => setRenamingId(null) },
                          )
                        }
                      >
                        Save
                      </Button>
                      <button type="button" onClick={() => setRenamingId(null)} className="rounded-full p-0.5 text-muted-foreground hover:text-foreground">
                        <X className="size-3" />
                        <span className="sr-only">Cancel rename</span>
                      </button>
                    </span>
                  ) : (
                    <>
                      <button type="button" onClick={() => onQuery(toLeadQuery(v.query))} className="hover:underline">
                        {v.name}
                      </button>
                      {mine && (
                        <button
                          type="button"
                          onClick={() => {
                            setRenameValue(v.name)
                            setRenamingId(v.id)
                          }}
                          className="rounded-full p-0.5 text-muted-foreground hover:text-foreground"
                        >
                          <Pencil className="size-3" />
                          <span className="sr-only">Rename {v.name}</span>
                        </button>
                      )}
                      {mine && (
                        <button type="button" onClick={() => deleteView.mutate(v.id)} className="rounded-full p-0.5 text-muted-foreground hover:text-destructive">
                          <X className="size-3" />
                          <span className="sr-only">Delete {v.name}</span>
                        </button>
                      )}
                    </>
                  )}
                </span>
              )
            })}
          </span>
        )}

        <label className="ml-auto flex items-center gap-2 text-sm text-muted-foreground">
          <input type="checkbox" checked={showArchived} onChange={(e) => onShowArchived(e.target.checked)} />
          Show archived
        </label>
      </div>

      <div>
        <p className="mb-2 text-[0.7rem] font-semibold uppercase tracking-[0.12em] text-muted-foreground">Quick filters</p>
        <div className="flex flex-wrap gap-2">
          {QUICK_FILTERS.map((f) => {
            const on = query.filters.includes(f.value)
            return (
              <button
                key={f.value}
                type="button"
                onClick={() => toggleFilter(f.value)}
                aria-pressed={on}
                className={cn(
                  'flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm transition-colors',
                  on ? 'border-primary bg-primary/10 text-primary' : 'border-border text-muted-foreground hover:border-primary/40 hover:text-foreground',
                )}
              >
                {f.label}
                <span className="text-xs tabular-nums opacity-70">{counts[f.value]}</span>
              </button>
            )
          })}
          {filtered && (
            <Button variant="ghost" size="sm" onClick={() => onQuery(EMPTY_QUERY)}>
              Clear
            </Button>
          )}
        </div>
      </div>

      <div className="grid gap-3 rounded-lg border border-border bg-card p-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="relative lg:col-span-2">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query.search}
            onChange={(e) => onQuery({ ...query, search: e.target.value })}
            placeholder="Search name, phone, email or notes…"
            className="pl-9"
            aria-label="Search leads"
          />
        </div>
        <Select value={query.status} onChange={(e) => onQuery({ ...query, status: e.target.value as LeadQuery['status'] })} aria-label="Stage">
          <option value="all">All stages</option>
          {STAGES.map((s) => (
            <option key={s.key} value={s.key}>
              {s.label}
            </option>
          ))}
        </Select>
        <Select value={query.assignee} onChange={(e) => onQuery({ ...query, assignee: e.target.value })} aria-label="Owner">
          <option value="all">Everyone</option>
          <option value="none">Unassigned</option>
          {assignees.map(([id, name]) => (
            <option key={id} value={id}>
              {name}
            </option>
          ))}
        </Select>
      </div>

      {selected.size > 0 && (
        <div className="no-print flex flex-wrap items-center gap-2 rounded-lg border border-primary/30 bg-primary/5 p-2" role="toolbar" aria-label="Bulk actions">
          <span className="text-sm font-medium">{selected.size} selected</span>
          <Select
            value=""
            aria-label="Move to stage"
            onChange={(e) => {
              const v = e.target.value as LeadStatus | ''
              // Lost needs its reason up front — the API refuses it without
              // one, so ask here instead of failing the whole batch after.
              if (v === 'lost') setLosing(true)
              else if (v) runBulk({ status: v })
            }}
            className="w-36"
          >
            <option value="">Move to…</option>
            {STAGES.map((s) => (
              <option key={s.key} value={s.key}>
                {s.label}
              </option>
            ))}
          </Select>
          <Select
            value=""
            aria-label="Assign to"
            onChange={(e) => {
              const v = e.target.value
              if (v === 'none') runBulk({ assigned_to: null })
              else if (v) runBulk({ assigned_to: v })
            }}
            className="w-40"
          >
            <option value="">Assign to…</option>
            <option value="none">Unassigned</option>
            {assignees.map(([id, name]) => (
              <option key={id} value={id}>
                {name}
              </option>
            ))}
          </Select>
          <Button size="sm" variant="outline" disabled={bulk.isPending} onClick={() => runBulk({ is_hot: true })}>
            Mark hot
          </Button>
          <Button size="sm" variant="outline" disabled={bulk.isPending} onClick={() => runBulk({ is_archived: !showArchived })}>
            {showArchived ? 'Restore' : 'Archive'}
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>
            Clear
          </Button>
          <Button size="sm" variant="outline" onClick={() => exportLeadsCsv(rows.filter((r) => selected.has(r.id)))}>
            <Download /> CSV
          </Button>
        </div>
      )}

      <LeadTable leads={rows} now={now} total={leads.length} onOpen={onOpen} selected={selected} onToggleSelect={toggleSelect} onToggleAll={toggleAll} />

      <LostReasonDialog
        open={losing}
        count={selected.size}
        pending={bulk.isPending}
        onCancel={() => setLosing(false)}
        onConfirm={(reason) => {
          setLosing(false)
          runBulk({ status: 'lost', lost_reason: reason })
        }}
      />
    </div>
  )
}
