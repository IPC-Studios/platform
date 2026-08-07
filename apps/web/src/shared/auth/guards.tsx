import { useEffect, type ReactNode } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { useAuth } from './AuthProvider'

/** Blocks children until a studio session exists; bounces to /login otherwise. */
export function RequireAuth({ children }: { children: ReactNode }) {
  const { session, loading } = useAuth()
  const navigate = useNavigate()

  useEffect(() => {
    if (!loading && !session) void navigate({ to: '/login' })
  }, [loading, session, navigate])

  if (loading) return <Centered>Loading…</Centered>
  if (!session) return null
  // An expired plan blocks the whole app except the (future) subscription page.
  if (session.plan_gate === 'expired') return <PlanExpired />
  return <>{children}</>
}

function PlanExpired() {
  return (
    <Centered>
      <div>
        <h1>Subscription expired</h1>
        <p>Your studio’s plan has lapsed. Renew to regain access.</p>
        {/* Phase 14 wires the Razorpay renewal flow here. */}
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
