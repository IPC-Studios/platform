import { useState, type FormEvent } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { registerResponse } from '@ipc/contracts'
import { supabase } from '@/shared/supabase'
import { callApi } from '@/shared/api/client'
import { useAuth } from '@/shared/auth/AuthProvider'

type Mode = 'signin' | 'register'

export function LoginPage() {
  const { refresh } = useAuth()
  const navigate = useNavigate()
  const [mode, setMode] = useState<Mode>('signin')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [companyName, setCompanyName] = useState('')
  const [adminName, setAdminName] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setBusy(true)
    try {
      if (mode === 'signin') {
        const { error } = await supabase.auth.signInWithPassword({ email, password })
        if (error) throw new Error(error.message)
      } else {
        const { error } = await supabase.auth.signUp({ email, password })
        if (error) throw new Error(error.message)
        // Create the studio (company + owner) once the session exists.
        await callApi('/auth/register', {
          method: 'POST',
          body: { company_name: companyName, admin_name: adminName, email },
          responseSchema: registerResponse,
        })
      }
      await refresh()
      await navigate({ to: '/dashboard' })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <main style={{ maxWidth: 360, margin: '10vh auto', fontFamily: 'system-ui' }}>
      <h1>IPC Studios</h1>
      <p>{mode === 'signin' ? 'Sign in to your studio.' : 'Create your studio.'}</p>
      <form onSubmit={onSubmit} style={{ display: 'grid', gap: 8 }}>
        {mode === 'register' && (
          <>
            <input placeholder="Studio name" value={companyName} onChange={(e) => setCompanyName(e.target.value)} required />
            <input placeholder="Your name" value={adminName} onChange={(e) => setAdminName(e.target.value)} required />
          </>
        )}
        <input type="email" placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        <input type="password" placeholder="Password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        {error && <p style={{ color: 'crimson', margin: 0 }}>{error}</p>}
        <button type="submit" disabled={busy}>
          {busy ? 'Please wait…' : mode === 'signin' ? 'Sign in' : 'Create studio'}
        </button>
      </form>
      <button
        type="button"
        onClick={() => setMode(mode === 'signin' ? 'register' : 'signin')}
        style={{ marginTop: 12, background: 'none', border: 'none', color: '#2563eb', cursor: 'pointer', padding: 0 }}
      >
        {mode === 'signin' ? 'New studio? Register' : 'Have an account? Sign in'}
      </button>
    </main>
  )
}
