import { Link } from '@tanstack/react-router'
import { Bell } from 'lucide-react'
import type { ReminderEntityType } from '@ipc/contracts'
import { Button } from '@/shared/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/shared/ui/card'
import { StatusBadge } from '@/shared/ui/status-badge'
import { useReminders } from './api'

const PRIORITY_TONE: Record<string, 'danger' | 'warning' | 'info' | 'neutral'> = {
  urgent: 'danger',
  high: 'warning',
  medium: 'info',
  low: 'neutral',
}

/**
 * Reminders for one entity (project, client, …): open follow-ups at a glance
 * with a handoff to the reminders board for the rest.
 *
 * The list endpoint only filters by status/priority server-side, so the
 * entity match happens here — the board is small enough that one cached
 * query feeds every panel on the page.
 */
export function EntityReminders({
  entityType,
  entityId,
  title,
  onNavigate,
}: {
  entityType: ReminderEntityType
  entityId: string
  title?: string
  /** Called when the board link is pressed (e.g. to close a dialog first). */
  onNavigate?: () => void
}) {
  const { data, isLoading } = useReminders({ status: 'active' })
  const rows = (data?.items ?? []).filter((r) => r.entity_type === entityType && r.entity_id === entityId)

  return (
    <Card className="self-start border-dashed">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-sm">
          <Bell className="size-4" aria-hidden /> {title ?? 'Reminders'}
          {rows.length > 0 && <StatusBadge tone="warning">{rows.length} open</StatusBadge>}
        </CardTitle>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <p className="text-sm text-muted-foreground">Loading reminders…</p>
        ) : rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Nothing open for this {entityType}. Follow-ups live on the reminders board.
          </p>
        ) : (
          <ul className="flex flex-col gap-1.5">
            {rows.slice(0, 3).map((r) => (
              <li
                key={r.id}
                className="flex items-center justify-between gap-2 rounded-md border border-border/60 px-2 py-1.5 text-sm"
              >
                <span className="min-w-0 truncate font-medium">{r.title}</span>
                <StatusBadge tone={PRIORITY_TONE[r.priority] ?? 'neutral'}>{r.priority}</StatusBadge>
              </li>
            ))}
            {rows.length > 3 && (
              <li className="text-xs text-muted-foreground">+ {rows.length - 3} more open</li>
            )}
          </ul>
        )}
        <Button variant="outline" size="sm" className="mt-2" asChild onClick={onNavigate}>
          <Link to="/reminders">Open reminders</Link>
        </Button>
      </CardContent>
    </Card>
  )
}
