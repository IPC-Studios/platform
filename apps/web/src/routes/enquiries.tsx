import { useState, type FormEvent } from 'react'
import { Link } from '@tanstack/react-router'
import { ExternalLink, Inbox, Mail, Pencil, Phone, Plus, Trash2, UserPlus } from 'lucide-react'
import type { Enquiry, EnquiryStatus, SaveEnquiryRequest } from '@ipc/contracts'
import { AuthedPage } from '@/shared/layout/AuthedPage'
import { PageHeader } from '@/shared/layout/page-header'
import { FilterTabs } from '@/shared/layout/filter-tabs'
import { Button } from '@/shared/ui/button'
import { Card, CardContent } from '@/shared/ui/card'
import { Dialog, DialogClose, DialogContent, DialogTrigger } from '@/shared/ui/dialog'
import { HowToUse } from '@/shared/ui/how-to-use'
import { Input, Label, Select } from '@/shared/ui/input'
import { SkeletonCards } from '@/shared/ui/skeleton'
import { StatCard } from '@/shared/ui/stat-card'
import { StatusBadge } from '@/shared/ui/status-badge'
import { EmptyState, ErrorState } from '@/shared/ui/states'
import { humanize } from '@/shared/ui/format'
import { useConfirm } from '@/shared/ui/confirm'
import { useAccess } from '@/shared/auth/useAccess'
import { useAuth } from '@/shared/auth/AuthProvider'
import { useDirectory } from '@/features/team/api'
import { useActiveLookups, useCreateCustomLookup } from '@/features/settings/api'
import {
  useConvertEnquiry,
  useDeleteEnquiry,
  useEnquiries,
  useSaveEnquiry,
} from '@/features/enquiries/api'

const TONE: Partial<Record<string, 'neutral' | 'info' | 'success' | 'warning'>> = {
  new: 'info',
  reviewed: 'neutral',
  contacted: 'warning',
  converted: 'success',
  closed: 'neutral',
}

const TABS: { value: EnquiryStatus | 'all'; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'new', label: 'New' },
  { value: 'reviewed', label: 'Reviewed' },
  { value: 'contacted', label: 'Contacted' },
  { value: 'converted', label: 'Converted' },
  { value: 'closed', label: 'Closed' },
]

/** Pick a studio-defined enquiry source, or add one inline without leaving the form (owner only). */
function EnquirySourcePicker({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const { session } = useAuth()
  const { data: sources } = useActiveLookups('enquiry_source')
  const createLookup = useCreateCustomLookup()
  const [adding, setAdding] = useState(false)
  const [name, setName] = useState('')

  async function onAdd() {
    if (!name.trim()) return
    await createLookup.mutateAsync({ category: 'enquiry_source', value: name.trim() })
    onChange(name.trim())
    setAdding(false)
    setName('')
  }

  if (adding) {
    return (
      <div className="flex flex-col gap-1.5">
        <Label>New source</Label>
        <div className="flex gap-2">
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. YouTube" autoFocus />
          <Button type="button" size="sm" onClick={() => void onAdd()} disabled={!name.trim() || createLookup.isPending}>
            Add
          </Button>
          <Button type="button" size="sm" variant="outline" onClick={() => setAdding(false)}>
            Cancel
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-1.5">
      <Label>Where from</Label>
      <Select
        value={value}
        onChange={(e) => {
          if (e.target.value === '__add__') setAdding(true)
          else onChange(e.target.value)
        }}
      >
        <option value="">Not sure</option>
        {/* A source logged before one was renamed or removed still shows its own text, unselected from the list. */}
        {value && !(sources ?? []).some((s) => s.value === value) && <option value={value}>{humanize(value)}</option>}
        {(sources ?? []).map((s) => (
          <option key={s.id} value={s.value}>
            {humanize(s.value)}
          </option>
        ))}
        {session?.is_owner && <option value="__add__">+ Add new source…</option>}
      </Select>
    </div>
  )
}

/** Pick a status — the 5 system ones plus whatever the studio has added, or add one inline (owner only). */
function EnquiryStatusPicker({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const { session } = useAuth()
  const { data: extra } = useActiveLookups('enquiry_status')
  const createLookup = useCreateCustomLookup()
  const [adding, setAdding] = useState(false)
  const [name, setName] = useState('')

  const systemValues = new Set(TABS.filter((t) => t.value !== 'all').map((t) => t.value))
  const custom = (extra ?? []).filter((s) => !systemValues.has(s.value as EnquiryStatus))

  async function onAdd() {
    if (!name.trim()) return
    await createLookup.mutateAsync({ category: 'enquiry_status', value: name.trim() })
    onChange(name.trim())
    setAdding(false)
    setName('')
  }

  if (adding) {
    return (
      <div className="flex flex-col gap-1.5">
        <Label>New status</Label>
        <div className="flex gap-2">
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Quoted" autoFocus />
          <Button type="button" size="sm" onClick={() => void onAdd()} disabled={!name.trim() || createLookup.isPending}>
            Add
          </Button>
          <Button type="button" size="sm" variant="outline" onClick={() => setAdding(false)}>
            Cancel
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-1.5">
      <Label>Status</Label>
      <Select
        value={value}
        onChange={(e) => {
          if (e.target.value === '__add__') setAdding(true)
          else onChange(e.target.value)
        }}
      >
        {TABS.filter((t) => t.value !== 'all').map((t) => (
          <option key={t.value} value={t.value}>
            {t.label}
          </option>
        ))}
        {/* A status logged before it was renamed or removed still shows its own text, unselected from the list. */}
        {value && !systemValues.has(value as EnquiryStatus) && !custom.some((s) => s.value === value) && (
          <option value={value}>{humanize(value)}</option>
        )}
        {custom.map((s) => (
          <option key={s.id} value={s.value}>
            {humanize(s.value)}
          </option>
        ))}
        {session?.is_owner && <option value="__add__">+ Add new status…</option>}
      </Select>
    </div>
  )
}

export function EnquiriesPage() {
  return (
    <AuthedPage module="crm">
      <Enquiries />
    </AuthedPage>
  )
}

/**
 * The inbox before the pipeline.
 *
 * Everything that comes in lands here — a form on the website, a phone call,
 * a DM — and most of it never becomes anything. Keeping it out of the lead
 * list is the point: a lead is work somebody owns, and a list full of
 * maybes is a list nobody opens.
 */
function Enquiries() {
  const access = useAccess()
  const canEdit = access.hasAction('crm', 'edit')
  const [tab, setTab] = useState<EnquiryStatus | 'all'>('all')
  const [search, setSearch] = useState('')
  const list = useEnquiries({ status: tab === 'all' ? null : tab, search })

  const pages = list.data?.pages ?? []
  const summary = pages[0]?.summary
  const items = pages.flatMap((p) => p.items)
  const hasMore = list.hasNextPage

  return (
    <>
      <PageHeader
        title="Enquiries"
        description="Everyone who has got in touch, before anyone starts chasing."
        actions={canEdit ? <EnquiryDialog /> : undefined}
      />

      <HowToUse
        title="Enquiries become leads"
        description="An enquiry is what arrived. A lead is work someone owns."
        steps={[
          'Log what came in — a call, a form, a DM.',
          'Mark it reviewed or contacted as you work through the list.',
          'Convert the real ones; the rest can be closed.',
        ]}
      />

      <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <StatCard label="Total" value={summary?.total_count ?? 0} />
        <StatCard label="Open" value={summary?.open_count ?? 0} />
        <StatCard label="New" value={summary?.new_count ?? 0} />
        <StatCard label="Reviewed" value={summary?.reviewed_count ?? 0} />
        <StatCard label="Contacted" value={summary?.contacted_count ?? 0} />
        <StatCard label="Converted" value={summary?.converted_count ?? 0} />
      </div>

      <div className="mt-6 flex flex-wrap items-center gap-3">
        <FilterTabs tabs={TABS} value={tab} onChange={setTab} />
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by name, phone or email…"
          aria-label="Search enquiries"
          className="sm:max-w-xs"
        />
      </div>

      <div className="mt-4">
        {list.isLoading ? (
          <SkeletonCards count={4} />
        ) : list.isError ? (
          <ErrorState onRetry={() => void list.refetch()} />
        ) : items.length === 0 ? (
          <EmptyState
            title={search || tab !== 'all' ? 'Nothing matches' : 'No enquiries yet'}
            description={
              search || tab !== 'all'
                ? 'Try a different filter or search.'
                : 'Log the next call or website form here and it will be waiting when you work the list.'
            }
            action={canEdit && !search && tab === 'all' ? <EnquiryDialog /> : undefined}
          />
        ) : (
          <div className="flex flex-col gap-2">
            {items.map((e) => (
              <EnquiryRow key={e.id} enquiry={e} canEdit={canEdit} />
            ))}
            {hasMore && (
              <div className="flex justify-center pt-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => void list.fetchNextPage()}
                  disabled={list.isFetchingNextPage}
                >
                  {list.isFetchingNextPage ? 'Loading…' : 'Show more'}
                </Button>
              </div>
            )}
          </div>
        )}
      </div>
    </>
  )
}

function EnquiryRow({ enquiry, canEdit }: { enquiry: Enquiry; canEdit: boolean }) {
  const remove = useDeleteEnquiry()
  const convert = useConvertEnquiry()
  const confirm = useConfirm()

  async function onDelete() {
    const yes = await confirm({
      title: `Delete the enquiry from ${enquiry.name}?`,
      description: 'This cannot be undone. Closing it instead keeps the record.',
      confirmLabel: 'Delete',
      destructive: true,
    })
    if (yes) remove.mutate(enquiry.id)
  }

  return (
    <Card>
      <CardContent className="flex flex-wrap items-start gap-3 p-4">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <Inbox className="size-4" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="font-medium">{enquiry.name}</p>
            <StatusBadge tone={TONE[enquiry.enquiry_status] ?? 'neutral'}>
              {humanize(enquiry.enquiry_status)}
            </StatusBadge>
            {enquiry.source && <StatusBadge>{humanize(enquiry.source)}</StatusBadge>}
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
            {enquiry.phone && (
              <a href={`tel:${enquiry.phone}`} className="flex items-center gap-1 hover:text-foreground">
                <Phone className="size-3.5" aria-hidden />
                {enquiry.phone}
              </a>
            )}
            {enquiry.email && (
              <a href={`mailto:${enquiry.email}`} className="flex items-center gap-1 hover:text-foreground">
                <Mail className="size-3.5" aria-hidden />
                {enquiry.email}
              </a>
            )}
            {enquiry.assigned_to_name && <span>· {enquiry.assigned_to_name}</span>}
          </div>
          {enquiry.message && (
            <p className="mt-1.5 line-clamp-2 text-sm text-muted-foreground">{enquiry.message}</p>
          )}
        </div>

        {canEdit && (
          <div className="flex items-center gap-1">
            {/* Already a lead: the button would make a second one, and the
                function would hand back the first anyway -- link to it instead. */}
            {enquiry.converted_lead_id && (
              <Button size="sm" variant="outline" asChild>
                <Link to="/follow-ups" search={{ lead: enquiry.converted_lead_id } as never}>
                  <ExternalLink /> View lead
                </Link>
              </Button>
            )}
            {!enquiry.converted_lead_id && (
              <Button
                size="sm"
                variant="outline"
                disabled={convert.isPending}
                onClick={() => convert.mutate({ id: enquiry.id })}
              >
                <UserPlus /> Convert
              </Button>
            )}
            <EnquiryDialog enquiry={enquiry} />
            <Button size="sm" variant="ghost" disabled={remove.isPending} onClick={() => void onDelete()}>
              <Trash2 />
              <span className="sr-only">Delete the enquiry from {enquiry.name}</span>
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

function EnquiryDialog({ enquiry }: { enquiry?: Enquiry }) {
  const save = useSaveEnquiry()
  const { data: directory } = useDirectory()
  const editing = !!enquiry
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState<SaveEnquiryRequest>(() => fromEnquiry(enquiry))

  function onSubmit(e: FormEvent) {
    e.preventDefault()
    save.mutate(
      { ...(editing ? { id: enquiry.id } : {}), body: draft },
      { onSuccess: () => setOpen(false) },
    )
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o)
        if (o) setDraft(fromEnquiry(enquiry))
      }}
    >
      <DialogTrigger asChild>
        {editing ? (
          <Button size="sm" variant="ghost">
            <Pencil />
            <span className="sr-only">Edit the enquiry from {enquiry.name}</span>
          </Button>
        ) : (
          <Button>
            <Plus /> Log an enquiry
          </Button>
        )}
      </DialogTrigger>
      <DialogContent
        title={editing ? `Edit ${enquiry.name}` : 'Log an enquiry'}
        description="Whatever you have is enough — a name and a number is a start."
      >
        <form onSubmit={onSubmit} className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <Label>Name</Label>
            <Input
              autoFocus
              value={draft.name}
              onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
              placeholder="Rahul Sharma"
            />
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <Label>Phone</Label>
              <Input
                value={draft.phone ?? ''}
                onChange={(e) => setDraft((d) => ({ ...d, phone: e.target.value }))}
                placeholder="9876543210"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>Email</Label>
              <Input
                value={draft.email ?? ''}
                onChange={(e) => setDraft((d) => ({ ...d, email: e.target.value }))}
                placeholder="rahul@example.com"
              />
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <EnquirySourcePicker
              value={draft.source ?? ''}
              onChange={(v) => setDraft((d) => ({ ...d, source: v || null }))}
            />
            <EnquiryStatusPicker
              value={draft.enquiry_status}
              onChange={(v) => setDraft((d) => ({ ...d, enquiry_status: v }))}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label>Who is looking after it</Label>
            <Select
              value={draft.assigned_to ?? ''}
              onChange={(e) => setDraft((d) => ({ ...d, assigned_to: e.target.value || null }))}
            >
              <option value="">Nobody yet</option>
              {(directory ?? []).map((m) => (
                <option key={m.user_id} value={m.user_id}>
                  {m.name}
                </option>
              ))}
            </Select>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label>What they said</Label>
            <textarea
              value={draft.message ?? ''}
              onChange={(e) => setDraft((d) => ({ ...d, message: e.target.value }))}
              rows={3}
              placeholder="Wedding in December, looking for candid plus film."
              className="w-full rounded-md border border-input bg-card px-3 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
          </div>

          <div className="flex justify-end gap-2">
            <DialogClose asChild>
              <Button type="button" variant="outline">
                Cancel
              </Button>
            </DialogClose>
            <Button type="submit" disabled={save.isPending || draft.name.trim().length < 2}>
              {save.isPending ? 'Saving…' : editing ? 'Save' : 'Log it'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}

const fromEnquiry = (e?: Enquiry): SaveEnquiryRequest => ({
  name: e?.name ?? '',
  phone: e?.phone ?? null,
  email: e?.email ?? null,
  message: e?.message ?? null,
  source: e?.source ?? null,
  enquiry_status: e?.enquiry_status ?? 'new',
  assigned_to: e?.assigned_to ?? null,
})
