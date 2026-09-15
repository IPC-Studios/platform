import { useState } from 'react'
import { Link } from '@tanstack/react-router'
import { Check, Copy, ExternalLink } from 'lucide-react'
import { toast } from 'sonner'
import type { Client } from '@ipc/contracts'
import { Button } from '@/shared/ui/button'
import { Dialog, DialogClose, DialogContent } from '@/shared/ui/dialog'
import { StatusBadge } from '@/shared/ui/status-badge'
import { EntityReminders } from '@/features/reminders/EntityReminders'
import { useClientProjects } from './api'
import { ClientFormDialog } from './ClientFormDialog'

function CopyButton({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <Button
      size="sm"
      variant="ghost"
      onClick={() => {
        void navigator.clipboard
          ?.writeText(value)
          .then(() => {
            setCopied(true)
            toast.success(`${label} copied`)
            setTimeout(() => setCopied(false), 1500)
          })
          .catch(() => toast.error('Could not copy.'))
      }}
    >
      {copied ? <Check /> : <Copy />} {copied ? 'Copied' : 'Copy'}
    </Button>
  )
}

/**
 * Quick client profile: contact with copy buttons, project history, and a
 * reminders stub that hands off to the reminders board.
 */
export function ClientDetailDialog({
  client,
  open,
  onOpenChange,
}: {
  client: Client | null
  open: boolean
  onOpenChange: (v: boolean) => void
}) {
  const { data: projects, isLoading, isError, refetch } = useClientProjects(client?.id ?? '')

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title={client?.name ?? 'Client'}
        description={client ? 'Contact, project history and follow-ups.' : undefined}
      >
        {!client ? null : (
          <div className="flex flex-col gap-4">
            <section className="rounded-lg border border-border bg-muted/30 p-3">
              <h4 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Contact
              </h4>
              <div className="flex flex-col gap-2 text-sm">
                <div className="flex items-center justify-between gap-2">
                  <span>
                    <span className="text-muted-foreground">Phone: </span>
                    <span className="font-medium">{client.phone ?? '—'}</span>
                  </span>
                  {client.phone && <CopyButton value={client.phone} label="Phone" />}
                </div>
                <div className="flex items-center justify-between gap-2">
                  <span className="min-w-0">
                    <span className="text-muted-foreground">Email: </span>
                    <span className="font-medium">{client.email ?? '—'}</span>
                  </span>
                  {client.email && <CopyButton value={client.email} label="Email" />}
                </div>
                {(client.city || client.address) && (
                  <p className="text-muted-foreground">
                    {[client.address, client.city].filter(Boolean).join(', ')}
                  </p>
                )}
                {client.relation && (
                  <p>
                    <StatusBadge tone="neutral">{client.relation}</StatusBadge>
                  </p>
                )}
              </div>
            </section>

            <section className="rounded-lg border border-border p-3">
              <h4 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Project history ({projects?.length ?? 0})
              </h4>
              {client.id && isLoading ? (
                <p className="py-3 text-center text-sm text-muted-foreground">Loading projects…</p>
              ) : isError ? (
                <p className="py-3 text-center text-sm text-destructive">
                  Could not load projects.{' '}
                  <button className="underline" onClick={() => void refetch()}>
                    Retry
                  </button>
                </p>
              ) : !projects || projects.length === 0 ? (
                <p className="rounded-md border border-dashed border-border p-4 text-center text-sm text-muted-foreground">
                  No projects linked to this client yet.
                </p>
              ) : (
                <ul className="divide-y divide-border">
                  {projects.map((p) => (
                    <li key={p.id} className="flex items-center justify-between gap-2 py-2 text-sm">
                      <span className="min-w-0">
                        <Link
                          to="/projects/$id"
                          params={{ id: p.id }}
                          className="truncate font-medium hover:underline"
                        >
                          {p.name}
                        </Link>
                        <span className="block text-xs text-muted-foreground">
                          {p.status} · {p.created_at.slice(0, 10)}
                        </span>
                      </span>
                      <Button size="sm" variant="ghost" asChild onClick={() => onOpenChange(false)}>
                        <Link to="/projects/$id" params={{ id: p.id }}>
                          Open <ExternalLink />
                        </Link>
                      </Button>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <EntityReminders
              entityType="client"
              entityId={client.id}
              title={`Reminders — ${client.name}`}
              onNavigate={() => onOpenChange(false)}
            />

            <div className="flex justify-end gap-2">
              <DialogClose asChild>
                <Button variant="outline">Close</Button>
              </DialogClose>
              <ClientFormDialog client={client} />
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
