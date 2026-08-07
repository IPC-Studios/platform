import { createContext, use, useCallback, useEffect, useState, type ReactNode } from 'react'
import { sessionState, type SessionState } from '@ipc/contracts'
import { supabase } from '../supabase'
import { callApi } from '../api/client'
import { MOCK_ENABLED, mockSession } from '../dev/mock'

interface AuthValue {
  session: SessionState | null
  loading: boolean
  refresh: () => Promise<void>
  signOut: () => Promise<void>
}

const AuthCtx = createContext<AuthValue | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<SessionState | null>(null)
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(async () => {
    if (MOCK_ENABLED) {
      setSession(mockSession)
      return
    }
    const { data } = await supabase.auth.getSession()
    if (!data.session) {
      setSession(null)
      return
    }
    try {
      // A signed-in user without a studio yet (pre-register) 403s — treat as null.
      setSession(await callApi('/auth/session', { responseSchema: sessionState }))
    } catch {
      setSession(null)
    }
  }, [])

  useEffect(() => {
    let active = true
    const boot = async () => {
      await refresh()
      if (active) setLoading(false)
    }
    void boot()
    const { data: sub } = supabase.auth.onAuthStateChange(() => {
      void refresh()
    })
    return () => {
      active = false
      sub.subscription.unsubscribe()
    }
  }, [refresh])

  const signOut = useCallback(async () => {
    await supabase.auth.signOut()
    setSession(null)
  }, [])

  return <AuthCtx value={{ session, loading, refresh, signOut }}>{children}</AuthCtx>
}

export function useAuth(): AuthValue {
  const v = use(AuthCtx)
  if (!v) throw new Error('useAuth must be used within <AuthProvider>')
  return v
}
