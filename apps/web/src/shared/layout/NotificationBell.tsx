import { Link } from '@tanstack/react-router'
import { Bell } from 'lucide-react'
import { useNotifications, unreadCount } from '@/features/crm/notifications'
import { useAccess } from '../auth/useAccess'
import { cn } from '../ui/cn'

/**
 * Alerts, with the count on the bell.
 *
 * The page existed already but nothing pointed at it except a sidebar row, so
 * an unread alert was only ever found by going looking for one. Gated on the
 * same module as that row, so the bell cannot offer a page this account would
 * be bounced out of.
 *
 * A failed or still-loading fetch shows a plain bell — never a zero, which
 * reads as "checked, nothing there" when nothing has been checked.
 */
export function NotificationBell() {
  const access = useAccess()
  const { data } = useNotifications()
  const unread = unreadCount(data)

  if (!access.hasModule('crm')) return null

  return (
    <Link
      to="/notifications"
      aria-label={unread > 0 ? `Alerts, ${unread} unread` : 'Alerts'}
      className={cn(
        'relative flex size-9 items-center justify-center rounded-md text-muted-foreground transition-colors',
        'hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
      )}
    >
      <Bell className="size-4" aria-hidden />
      {unread > 0 && (
        <span
          aria-hidden
          className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[0.6rem] font-semibold leading-none text-destructive-foreground"
        >
          {unread > 9 ? '9+' : unread}
        </span>
      )}
    </Link>
  )
}
