import { createContext, use, useCallback, useEffect, useState, type ReactNode } from 'react'
import { sessionState, type SessionState } from '@ipc/contracts'
import { callApi } from '../api/client'
import { getToken, clearToken } from './token'
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
    if (!getToken()) {
      setSession(null)
      return
    }
    try {
      // Token present but no studio yet, or expired → API 401/403 → treat as null.
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
    return () => {
      active = false
    }
  }, [refresh])

  const signOut = useCallback(async () => {
    clearToken()
    setSession(null)
  }, [])

  return <AuthCtx value={{ session, loading, refresh, signOut }}>{children}</AuthCtx>
}

export function useAuth(): AuthValue {
  const v = use(AuthCtx)
  if (!v) throw new Error('useAuth must be used within <AuthProvider>')
  return v
}
