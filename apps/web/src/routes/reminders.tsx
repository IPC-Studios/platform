import { useState } from 'react'
import { Link } from '@tanstack/react-router'
import { AuthedPage } from '@/shared/layout/AuthedPage'
import { PageHeader } from '@/shared/layout/page-header'
import { StatCard } from '@/shared/ui/stat-card'
import { Button } from '@/shared/ui/button'
import { Input } from '@/shared/ui/input'
import { Badge } from '@/shared/ui/badge'
import { Dialog, DialogContent } from '@/shared/ui/dialog'
import { Select } from '@/shared/ui/select'
import {
  useReminders,
  useSaveReminder,
  useUpdateReminderStatus,
  useDeleteReminder,
} from '@/features/reminders/api'
import { useLeads } from '@/features/crm/api'
import { useProjects } from '@/features/projects/api'
import { useClients } from '@/features/clients/api'
import { useInvoices } from '@/features/billing/api'
import { type CreateReminderRequest, type ReminderEntityType } from '@ipc/contracts'
import { Plus, Trash2, CheckCircle, Clock, AlertTriangle, Bell, Link2 } from 'lucide-react'

const ENTITY_LINK: Partial<
  Record<ReminderEntityType, (id: string) => { to: string; params: Record<string, string>; search?: Record<string, string> }>
> = {
  project: (id) => ({ to: '/projects/$id', params: { id } }),
  lead: (id) => ({ to: '/follow-ups', params: {}, search: { lead: id } }),
}

/** Which entity is picked determines which list is fetched — no point loading all four. */
function EntityPicker({
  entityType,
  entityId,
  onChangeId,
}: {
  entityType: ReminderEntityType | null | undefined
  entityId: string | null | undefined
  onChangeId: (id: string | null) => void
}) {
  const leads = useLeads()
  const projects = useProjects()
  const clients = useClients()
  const invoices = useInvoices()

  if (!entityType || entityType === 'custom') return null

  const options =
    entityType === 'lead'
      ? (leads.data ?? []).map((l) => ({ id: l.id, label: l.name ?? l.phone ?? 'Unnamed deal' }))
      : entityType === 'project'
        ? (projects.data ?? []).map((p) => ({ id: p.id, label: p.name }))
        : entityType === 'client'
          ? (clients.data ?? []).map((c) => ({ id: c.id, label: c.name }))
          : (invoices.data ?? []).map((i) => ({ id: i.id, label: i.invoice_number }))

  return (
    <div>
      <label className="text-sm font-medium">Linked {entityType}</label>
      <Select value={entityId ?? ''} onChange={(e) => onChangeId(e.target.value || null)}>
        <option value="">Select…</option>
        {options.map((o) => (
          <option key={o.id} value={o.id}>
            {o.label}
          </option>
        ))}
      </Select>
    </div>
  )
}

function RemindersContent() {
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [form, setForm] = useState<CreateReminderRequest>({
    title: '',
    description: null,
    priority: 'medium',
    entity_type: null,
    entity_id: null,
    due_at: null,
  })

  const { data } = useReminders()
  const saveReminder = useSaveReminder()
  const updateStatus = useUpdateReminderStatus()
  const deleteReminder = useDeleteReminder()

  const items = data?.items ?? []
  const summary = data?.summary

  function openCreate() {
    setEditingId(null)
    setForm({ title: '', description: null, priority: 'medium', entity_type: null, entity_id: null, due_at: null })
    setDialogOpen(true)
  }

  function openEdit(reminder: (typeof items)[0]) {
    setEditingId(reminder.id)
    setForm({
      title: reminder.title,
      description: reminder.description,
      priority: reminder.priority as CreateReminderRequest['priority'],
      entity_type: reminder.entity_type as CreateReminderRequest['entity_type'],
      entity_id: reminder.entity_id,
      due_at: reminder.due_at,
    })
    setDialogOpen(true)
  }

  function handleSubmit() {
    if (!form.title.trim()) return
    saveReminder.mutate(
      { id: editingId ?? undefined, body: form },
      { onSuccess: () => setDialogOpen(false) },
    )
  }

  const priorityColors = {
    low: 'bg-gray-100 text-gray-800',
    medium: 'bg-blue-100 text-blue-800',
    high: 'bg-orange-100 text-orange-800',
    urgent: 'bg-red-100 text-red-800',
  }

  const priorityIcons = {
    low: <Clock className="h-3 w-3" />,
    medium: <Bell className="h-3 w-3" />,
    high: <AlertTriangle className="h-3 w-3" />,
    urgent: <AlertTriangle className="h-3 w-3" />,
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Reminders"
        description="Manage your reminders and tasks"
        actions={
          <Button onClick={openCreate} size="sm">
            <Plus className="mr-1 h-4 w-4" /> New Reminder
          </Button>
        }
      />

      {summary && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard label="Total" value={summary.total_count} icon={Bell} />
          <StatCard label="Active" value={summary.active_count} icon={Clock} />
          <StatCard label="Overdue" value={summary.overdue_count} icon={AlertTriangle} />
          <StatCard label="Due Today" value={summary.due_today_count} icon={CheckCircle} />
        </div>
      )}

      <div className="space-y-2">
        {items.map((reminder) => (
          <div
            key={reminder.id}
            className="flex items-center justify-between rounded-lg border bg-card p-4 transition-colors hover:bg-accent/50"
          >
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <Badge className={priorityColors[reminder.priority]}>
                  {priorityIcons[reminder.priority]}
                  {reminder.priority}
                </Badge>
                <span className="font-medium">{reminder.title}</span>
              </div>
              {reminder.description && (
                <p className="mt-1 truncate text-sm text-muted-foreground">{reminder.description}</p>
              )}
              {reminder.due_at && (
                <p className="mt-1 text-xs text-muted-foreground">
                  Due: {new Date(reminder.due_at).toLocaleDateString()}
                </p>
              )}
              {reminder.entity_type && reminder.entity_name && (
                <p className="mt-1 flex items-center gap-1 text-xs text-muted-foreground">
                  <Link2 className="h-3 w-3" />
                  {(() => {
                    const link = reminder.entity_id && ENTITY_LINK[reminder.entity_type]?.(reminder.entity_id)
                    return link ? (
                      <Link to={link.to} params={link.params} search={link.search as never} className="hover:underline">
                        {reminder.entity_name}
                      </Link>
                    ) : (
                      <span>{reminder.entity_name}</span>
                    )
                  })()}
                  <span>({reminder.entity_type})</span>
                </p>
              )}
            </div>
            <div className="flex items-center gap-1">
              {reminder.status === 'active' && (
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 text-green-600"
                  onClick={() => updateStatus.mutate({ id: reminder.id, status: 'completed' })}
                >
                  <CheckCircle className="h-4 w-4" />
                </Button>
              )}
              <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => openEdit(reminder)}>
                <Clock className="h-4 w-4" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 text-destructive"
                onClick={() => { if (confirm('Delete this reminder?')) deleteReminder.mutate(reminder.id) }}
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          </div>
        ))}
        {items.length === 0 && (
          <div className="py-12 text-center text-muted-foreground">No reminders yet.</div>
        )}
      </div>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent title={editingId ? 'Edit Reminder' : 'New Reminder'}>
          <div className="space-y-4">
            <div>
              <label className="text-sm font-medium">Title</label>
              <Input
                value={form.title}
                onChange={(e) => setForm({ ...form, title: e.target.value })}
                placeholder="What do you need to remember?"
              />
            </div>
            <div>
              <label className="text-sm font-medium">Description</label>
              <Input
                value={form.description ?? ''}
                onChange={(e) => setForm({ ...form, description: e.target.value || null })}
                placeholder="Optional details"
              />
            </div>
            <div>
              <label className="text-sm font-medium">Priority</label>
              <Select value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value as CreateReminderRequest['priority'] })}>
                <option value="low">Low</option>
                <option value="medium">Medium</option>
                <option value="high">High</option>
                <option value="urgent">Urgent</option>
              </Select>
            </div>
            <div>
              <label className="text-sm font-medium">Due Date</label>
              <Input
                type="datetime-local"
                value={form.due_at ? new Date(form.due_at).toISOString().slice(0, 16) : ''}
                onChange={(e) => setForm({ ...form, due_at: e.target.value ? new Date(e.target.value).toISOString() : null })}
              />
            </div>
            <div>
              <label className="text-sm font-medium">Link to (optional)</label>
              <Select
                value={form.entity_type ?? ''}
                onChange={(e) => {
                  const next = (e.target.value || null) as ReminderEntityType | null
                  setForm({ ...form, entity_type: next, entity_id: null })
                }}
              >
                <option value="">Nothing — just a note</option>
                <option value="lead">A deal</option>
                <option value="project">A project</option>
                <option value="client">A client</option>
                <option value="invoice">An invoice</option>
              </Select>
            </div>
            <EntityPicker
              entityType={form.entity_type}
              entityId={form.entity_id}
              onChangeId={(id) => setForm({ ...form, entity_id: id })}
            />
          </div>
          <div className="mt-6 flex justify-end gap-2">
            <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button>
            <Button onClick={handleSubmit} disabled={!form.title.trim() || saveReminder.isPending}>
              {saveReminder.isPending ? 'Saving...' : 'Save'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}

export function RemindersPage() {
  return (
    <AuthedPage module="dashboard">
      <RemindersContent />
    </AuthedPage>
  )
}
