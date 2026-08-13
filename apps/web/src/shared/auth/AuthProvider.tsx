import { createContext, use, useCallback, useEffect, useState, type ReactNode } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { z, sessionState, type SessionState } from '@ipc/contracts'
import { callApi, setAuthLostHandler } from '../api/client'
import { getToken, getRefreshToken, clearToken } from './token'
import { MOCK_ENABLED, mockSession } from '../dev/mock'

const ok = z.object({ ok: z.boolean() })

interface AuthValue {
  session: SessionState | null
  loading: boolean
  refresh: () => Promise<void>
  signOut: () => Promise<void>
  signOutEverywhere: () => Promise<void>
}

const AuthCtx = createContext<AuthValue | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<SessionState | null>(null)
  const [loading, setLoading] = useState(true)
  const qc = useQueryClient()

  /**
   * End the local session. The query cache holds one tenant's rows, so it must
   * go with it — otherwise the next account signed in on this machine is served
   * the previous studio's data straight from cache.
   */
  const endSession = useCallback(() => {
    clearToken()
    setSession(null)
    qc.clear()
  }, [qc])

  // A refused refresh means the session is gone server-side; drop it here too so
  // the route guard bounces to /login instead of leaving a shell that errors.
  useEffect(() => {
    setAuthLostHandler(() => endSession())
    return () => setAuthLostHandler(null)
  }, [endSession])

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
    const refresh_token = getRefreshToken()
    // Drop the session first: sign-out must feel instant and must not hinge on
    // the network. The server call just revokes the family behind us.
    endSession()
    if (!MOCK_ENABLED && refresh_token) {
      await callApi('/auth/logout', {
        method: 'POST',
        body: { refresh_token },
        responseSchema: ok,
      }).catch(() => null)
    }
  }, [endSession])

  /**
   * Sign out on every device, this one included. The server call is the whole
   * point here, so a failure propagates — the caller must not tell the user
   * their other devices are dead when nothing was revoked.
   */
  const signOutEverywhere = useCallback(async () => {
    try {
      if (!MOCK_ENABLED) {
        await callApi('/auth/logout-all', { method: 'POST', responseSchema: ok })
      }
    } finally {
      endSession()
    }
  }, [endSession])

  return (
    <AuthCtx value={{ session, loading, refresh, signOut, signOutEverywhere }}>{children}</AuthCtx>
  )
}

export function useAuth(): AuthValue {
  const v = use(AuthCtx)
  if (!v) throw new Error('useAuth must be used within <AuthProvider>')
  return v
}
