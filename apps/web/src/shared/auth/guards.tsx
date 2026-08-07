import { useEffect, type ReactNode } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { useAuth } from './AuthProvider'

/**
 * Blocks children until a studio session exists; bounces to /login otherwise.
 * An expired plan blocks the whole app EXCEPT pages that pass allowExpired
 * (the subscription/renewal page — the recovery path).
 */
export function RequireAuth({
  children,
  allowExpired = false,
}: {
  children: ReactNode
  allowExpired?: boolean
}) {
  const { session, loading } = useAuth()
  const navigate = useNavigate()

  useEffect(() => {
    if (!loading && !session) void navigate({ to: '/login' })
  }, [loading, session, navigate])

  if (loading) return <Centered>Loading…</Centered>
  if (!session) return null
  if (session.plan_gate === 'expired' && !allowExpired) return <PlanExpired />
  return <>{children}</>
}

function PlanExpired() {
  const navigate = useNavigate()
  return (
    <Centered>
      <div className="max-w-sm">
        <h1 className="text-xl font-semibold">Subscription expired</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Your studio’s plan has lapsed. Renew to regain access.
        </p>
        <button
          type="button"
          onClick={() => void navigate({ to: '/settings/subscription' })}
          className="mt-4 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
        >
          Renew plan
        </button>
      </div>
    </Centered>
  )
}

function Centered({ children }: { children: ReactNode }) {
  return (
    <div
      style={{
        minHeight: '60vh',
        display: 'grid',
        placeItems: 'center',
        fontFamily: 'system-ui',
        textAlign: 'center',
      }}
    >
      {children}
    </div>
  )
}
