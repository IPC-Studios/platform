import { useState } from 'react'
import { Link } from '@tanstack/react-router'
import { Check, ChevronDown, ListChecks } from 'lucide-react'
import type { CrmLead } from '@ipc/contracts'
import { Card, CardContent } from '@/shared/ui/card'
import { Button } from '@/shared/ui/button'
import { cn } from '@/shared/ui/cn'
import { useDirectory } from '@/features/team/api'
import { useDistribution } from './api'
import { loadViews } from './views'

interface ChecklistItem {
  title: string
  where: string
  done: boolean
  to?: string
}

/**
 * Getting a CRM launch-ready.
 *
 * Every item is checked against something real — no item can be ticked by
 * pressing a button here, because a checklist you can satisfy without doing the
 * work is worse than no checklist. It hides itself once everything is done.
 */
export function SetupChecklist({ leads }: { leads: readonly CrmLead[]; onAddLead?: () => void }) {
  const [open, setOpen] = useState(true)
  const { data: team } = useDirectory()
  const { data: rota } = useDistribution()

  const items: ChecklistItem[] = [
    {
      title: 'Add your team',
      where: 'Team → Team Directory',
      to: '/employees',
      done: (team?.length ?? 0) > 1,
    },
    {
      title: 'Set up lead distribution',
      where: 'CRM → Distribution Rules',
      done: (rota ?? []).some((r) => r.is_active),
    },
    {
      title: 'Add your first lead',
      where: 'Add lead, or connect a web form',
      done: leads.length > 0,
    },
    {
      title: 'Give every open lead an owner',
      where: 'Lead drawer → Owner',
      done:
        leads.length > 0 &&
        !leads.some((l) => l.assigned_to === null && l.status !== 'converted' && l.status !== 'lost'),
    },
    {
      title: 'Contact a lead',
      where: 'Move it past New',
      done: leads.some((l) => l.last_contacted_at !== null),
    },
    {
      title: 'Schedule a follow-up',
      where: 'Lead drawer → Next follow-up',
      done: leads.some((l) => l.follow_up_at !== null),
    },
    {
      title: 'Send a quotation',
      where: 'Move a lead to Proposal sent',
      done: leads.some((l) => l.status === 'proposal_sent' || l.status === 'converted'),
    },
    {
      title: 'Save a personal view',
      where: 'Lead Inbox → Save current view',
      done: loadViews().length > 0,
    },
  ]

  const done = items.filter((i) => i.done).length
  const pct = Math.round((done / items.length) * 100)

  // A finished checklist is clutter; it comes back only if something regresses.
  if (done === items.length) return null

  return (
    <Card className="mt-4">
      <CardContent className="p-4">
        <div className="flex flex-wrap items-center gap-3">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <ListChecks className="size-4" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="font-medium">CRM setup checklist</p>
            <p className="text-xs text-muted-foreground">
              {done} of {items.length} done · get your CRM launch-ready
            </p>
          </div>
          <div className="flex items-center gap-3">
            <div className="h-1.5 w-28 overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label="CRM setup progress">
              <div className="h-full rounded-full bg-primary transition-[width] duration-500" style={{ width: `${pct}%` }} />
            </div>
            <span className="text-sm font-medium tabular-nums">{pct}%</span>
            <Button variant="ghost" size="icon" onClick={() => setOpen((o) => !o)}>
              <ChevronDown className={cn('transition-transform', open && 'rotate-180')} />
              <span className="sr-only">{open ? 'Hide checklist' : 'Show checklist'}</span>
            </Button>
          </div>
        </div>

        {open && (
          <ul className="mt-4 divide-y divide-border border-t border-border">
            {items.map((item) => (
              <li key={item.title} className="flex flex-wrap items-center gap-3 py-2.5">
                <span
                  className={cn(
                    'flex size-5 shrink-0 items-center justify-center rounded-full border',
                    item.done
                      ? 'border-transparent bg-success/15 text-success'
                      : 'border-border text-transparent',
                  )}
                >
                  <Check className="size-3" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className={cn('truncate text-sm', item.done && 'text-muted-foreground line-through')}>
                    {item.title}
                  </p>
                  <p className="truncate text-xs text-muted-foreground">{item.where}</p>
                </div>
                {!item.done && item.to && (
                  <Button size="sm" variant="outline" asChild>
                    <Link to={item.to}>Set up</Link>
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  )
}
