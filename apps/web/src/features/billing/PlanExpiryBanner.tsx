import { Link } from '@tanstack/react-router'
import { AlertTriangle } from 'lucide-react'
import { useAuth } from '@/shared/auth/AuthProvider'
import { StatusBadge } from '@/shared/ui/status-badge'
import { humanize } from '@/shared/ui/format'

/**
 * Lovable parity: plan-expiry banner. Owners (and the admin billing allowlist:
 * an expired owner can still open settings + subscription) see renewal inline;
 * everyone else sees a read-only notice.
 */
export function PlanExpiryBanner() {
  const { session } = useAuth()
  if (!session) return null
  if (session.plan_gate === 'active' || session.plan_gate === 'grandfathered') return null
  const tone = session.plan_gate === 'grace' ? 'warning' : 'danger'
  return (
    <div className={`mb-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border px-4 py-3 text-sm ${tone === 'warning' ? 'border-warning/40 bg-warning/10' : 'border-destructive/40 bg-destructive/10'}`}>
      <p className="flex items-center gap-2">
        <AlertTriangle className="size-4 shrink-0" />
        <span>
          {session.plan_gate === 'grace'
            ? `Your plan is in grace${session.plan_expiry ? ` until ${new Date(session.plan_expiry).toLocaleDateString('en-IN')}` : ''}. Renew to keep everything running.`
            : 'Your plan has expired. Renew to restore full access.'}
        </span>
      </p>
      {session.is_owner && (
        <Link to="/settings/subscription" className="font-medium text-primary hover:underline">
          <StatusBadge tone={tone}>{humanize(session.plan_gate)}</StatusBadge> Renew now
        </Link>
      )}
    </div>
  )
}
