import { createContext, use, useEffect, useState, type ReactNode } from 'react'
import type { SessionState } from '@ipc/contracts'
import { supabase } from '../supabase'

interface AuthValue {
  session: SessionState | null
  loading: boolean
  signOut: () => Promise<void>
}

const AuthCtx = createContext<AuthValue | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<SessionState | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    // Phase 1 wires the real /auth/session hydration off the Supabase session.
    // Skeleton: just track whether a Supabase session exists.
    const { data: sub } = supabase.auth.onAuthStateChange((_evt, s) => {
      if (!s) setSession(null)
      setLoading(false)
    })
    supabase.auth.getSession().then(() => setLoading(false))
    return () => sub.subscription.unsubscribe()
  }, [])

  const signOut = async () => {
    await supabase.auth.signOut()
    setSession(null)
  }

  return <AuthCtx value={{ session, loading, signOut }}>{children}</AuthCtx>
}

export function useAuth(): AuthValue {
  const v = use(AuthCtx)
  if (!v) throw new Error('useAuth must be used within <AuthProvider>')
  return v
}
