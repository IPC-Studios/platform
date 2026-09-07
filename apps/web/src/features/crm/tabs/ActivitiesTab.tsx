import { useMemo, useState } from 'react'
import { Link } from '@tanstack/react-router'
import { CalendarPlus, Check, ClipboardList, Mail, MessageCircle, Phone, StickyNote, Trash2 } from 'lucide-react'
import type { ActivityType, CrmActivity, CrmLead } from '@ipc/contracts'
import { ACTIVITY_LABEL, describeActivity } from '@ipc/domain'
import { Button } from '@/shared/ui/button'
import { Card, CardContent } from '@/shared/ui/card'
import { Select } from '@/shared/ui/input'
import { SkeletonList } from '@/shared/ui/skeleton'
import { EmptyState, ErrorState } from '@/shared/ui/states'
import { StatCard } from '@/shared/ui/stat-card'
import { cn } from '@/shared/ui/cn'
import { useConfirm } from '@/shared/ui/confirm'
import { useCrmAccess } from '../access'
import { useActivities, useDeleteActivity, useUpdateActivity } from '../api'

const when = new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })

const ICON: Record<ActivityType, typeof Phone> = {
  call: Phone,
  email: Mail,
  meeting: CalendarPlus,
  note: StickyNote,
  task: ClipboardList,
  whatsapp: MessageCircle,
  sms: MessageCircle,
}

/**
 * The studio's activity feed: every call, message, meeting, note and task
 * across every deal, with the open tasks pulled to the top. Click a row to
 * open the deal it belongs to.
 */
export function ActivitiesTab({ leads, onOpen }: { leads: readonly CrmLead[]; onOpen: (id: string) => void }) {
  const [type, setType] = useState<ActivityType | ''>('')
  const [owner, setOwner] = useState('')
  const feed = useActivities({ ...(type ? { type } : {}), ...(owner ? { assignedTo: owner } : {}) })
  const tasks = useActivities({ openTasks: true })
  const update = useUpdateActivity()
  const del = useDeleteActivity()
  const confirm = useConfirm()
  const { canEdit, canDelete } = useCrmAccess()

  async function remove(id: string) {
    const yes = await confirm({
      title: 'Remove this from the timeline?',
      description: 'It disappears from the history for everyone.',
      confirmLabel: 'Remove',
      destructive: true,
    })
    if (yes) del.mutate(id)
  }

  const owners = useMemo(() => {
    const seen = new Map<string, string>()
    for (const l of leads) if (l.assigned_to) seen.set(l.assigned_to, l.assignee_name ?? 'Unknown')
    return [...seen.entries()]
  }, [leads])

  const rows = feed.data ?? []
  const openTasks = tasks.data ?? []
  const now = Date.now()
  const overdue = openTasks.filter((t) => t.due_at && new Date(t.due_at).getTime() < now).length
  const week = rows.filter((a) => now - new Date(a.created_at).getTime() < 7 * 86_400_000)
  const calls = week.filter((a) => a.type === 'call').length
  const messages = week.filter((a) => a.type === 'email' || a.type === 'whatsapp' || a.type === 'sms').length

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="Open tasks" value={openTasks.length} />
        <StatCard label="Overdue tasks" value={overdue} />
        <StatCard label="Calls this week" value={calls} />
        <StatCard label="Messages this week" value={messages} />
      </div>

      {openTasks.length > 0 && (
        <Card>
          <CardContent className="p-4">
            <p className="font-medium">Open tasks</p>
            <p className="mt-0.5 text-xs text-muted-foreground">Oldest due first. Tick one off when it is done.</p>
            <ul className="mt-3 divide-y divide-border">
              {openTasks.slice(0, 20).map((t) => (
                <ActivityRow
                  key={t.id}
                  a={t}
                  onOpen={onOpen}
                  canEdit={canEdit}
                  canDelete={canDelete}
                  onDone={() => update.mutate({ id: t.id, patch: { done: true } })}
                  onDelete={() => void remove(t.id)}
                />
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <Select value={type} onChange={(e) => setType(e.target.value as ActivityType | '')} className="w-40" aria-label="Type">
          <option value="">All types</option>
          {(Object.keys(ACTIVITY_LABEL) as ActivityType[]).map((t) => (
            <option key={t} value={t}>
              {ACTIVITY_LABEL[t]}
            </option>
          ))}
        </Select>
        <Select value={owner} onChange={(e) => setOwner(e.target.value)} className="w-44" aria-label="Owner">
          <option value="">Everyone</option>
          {owners.map(([id, name]) => (
            <option key={id} value={id}>
              {name}
            </option>
          ))}
        </Select>
      </div>

      {feed.isLoading ? (
        <SkeletonList rows={6} columns={3} />
      ) : feed.isError ? (
        <ErrorState error={feed.error} onRetry={() => void feed.refetch()} />
      ) : rows.length === 0 ? (
        <Card>
          <CardContent className="py-4">
            <EmptyState title="No activity yet." description="Log a call, a note or a task from any deal and it shows up here." />
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="p-4">
            <ul className="divide-y divide-border">
              {rows.map((a) => (
                <ActivityRow
                  key={a.id}
                  a={a}
                  onOpen={onOpen}
                  canEdit={canEdit}
                  canDelete={canDelete}
                  onDone={() => update.mutate({ id: a.id, patch: { done: !a.done_at } })}
                  onDelete={() => void remove(a.id)}
                />
              ))}
            </ul>
          </CardContent>
        </Card>
      )}
    </div>
  )
}

function ActivityRow({
  a,
  onOpen,
  canEdit,
  canDelete,
  onDone,
  onDelete,
}: {
  a: CrmActivity
  onOpen: (id: string) => void
  canEdit: boolean
  canDelete: boolean
  onDone: () => void
  onDelete: () => void
}) {
  const Icon = ICON[a.type]
  const overdue = a.type === 'task' && !a.done_at && !!a.due_at && new Date(a.due_at).getTime() < Date.now()
  return (
    <li className="flex items-start gap-3 py-2 text-sm">
      <Icon className={cn('mt-0.5 size-4 shrink-0', overdue ? 'text-destructive' : 'text-muted-foreground')} />
      <div className="min-w-0 flex-1">
        <p className={cn('truncate', a.done_at && 'text-muted-foreground line-through')}>{describeActivity(a)}</p>
        <p className="truncate text-xs text-muted-foreground">
          {a.lead_id ? (
            <button type="button" onClick={() => onOpen(a.lead_id!)} className="hover:underline">
              {a.lead_name ?? 'Open deal'}
            </button>
          ) : a.contact_id ? (
            // Activities can hang off a person rather than a deal; this used
            // to be the dead word "Contact".
            <Link to="/crm/contacts" search={{ contact: a.contact_id } as never} className="hover:underline">
              {a.contact_name ?? 'Open contact'}
            </Link>
          ) : (
            '—'
          )}
          {' · '}
          <span className="tabular-nums">{when.format(new Date(a.started_at ?? a.created_at))}</span>
          {a.actor_name ? ` · ${a.actor_name}` : ''}
          {a.type === 'task' && a.assignee_name ? ` · for ${a.assignee_name}` : ''}
        </p>
      </div>
      {a.type === 'task' && canEdit && (
        <Button size="sm" variant={a.done_at ? 'ghost' : 'outline'} onClick={onDone}>
          <Check /> {a.done_at ? 'Reopen' : 'Done'}
        </Button>
      )}
      {canDelete && (
        <Button size="sm" variant="ghost" onClick={onDelete} title="Remove">
          <Trash2 className="size-3.5" />
          <span className="sr-only">Remove</span>
        </Button>
      )}
    </li>
  )
}
