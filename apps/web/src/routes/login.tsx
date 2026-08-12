import { useState, type FormEvent } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { Camera, MailCheck } from 'lucide-react'
import { z, authToken, registerResult } from '@ipc/contracts'
import { callApi, ApiError } from '@/shared/api/client'
import { setToken } from '@/shared/auth/token'
import { MOCK_ENABLED } from '@/shared/dev/mock'
import { useAuth } from '@/shared/auth/AuthProvider'
import { Button } from '@/shared/ui/button'
import { Card, CardContent } from '@/shared/ui/card'
import { Input, Label } from '@/shared/ui/input'

type Mode = 'signin' | 'register'
const ok = z.object({ ok: z.boolean() })

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
  // Set once the user needs to verify their email (after register, or a 403 login).
  const [pendingEmail, setPendingEmail] = useState<string | null>(null)
  const [resent, setResent] = useState(false)

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setBusy(true)
    try {
      if (MOCK_ENABLED) {
        await refresh()
        await navigate({ to: '/dashboard' })
        return
      }
      if (mode === 'register') {
        await callApi('/auth/register', {
          method: 'POST',
          body: { company_name: companyName, admin_name: adminName, email, password },
          responseSchema: registerResult,
        })
        setPendingEmail(email) // show the "check your inbox" screen
        return
      }
      const { access_token } = await callApi('/auth/login', {
        method: 'POST',
        body: { email, password },
        responseSchema: authToken,
      })
      setToken(access_token)
      await refresh()
      await navigate({ to: '/dashboard' })
    } catch (err) {
      // A 403 on sign-in means the email isn't verified yet.
      if (err instanceof ApiError && err.status === 403) {
        setPendingEmail(email)
      } else {
        setError(err instanceof Error ? err.message : 'Something went wrong.')
      }
    } finally {
      setBusy(false)
    }
  }

  async function resend() {
    if (!pendingEmail) return
    setBusy(true)
    try {
      await callApi('/auth/resend-verification', {
        method: 'POST',
        body: { email: pendingEmail },
        responseSchema: ok,
      })
      setResent(true)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-muted/40 p-4">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex flex-col items-center gap-2 text-center">
          <span className="flex size-11 items-center justify-center rounded-xl bg-primary text-primary-foreground">
            <Camera className="size-6" />
          </span>
          <h1 className="text-xl font-semibold tracking-tight">
            IPC <span className="text-brand">Studios</span>
          </h1>
          <p className="text-sm text-muted-foreground">
            {pendingEmail
              ? 'Verify your email to continue.'
              : mode === 'signin'
                ? 'Sign in to your studio workspace.'
                : 'Create your studio workspace.'}
          </p>
        </div>

        {pendingEmail ? (
          <Card>
            <CardContent className="flex flex-col items-center gap-4 p-6 text-center">
              <span className="flex size-11 items-center justify-center rounded-full bg-primary/10 text-primary">
                <MailCheck className="size-6" />
              </span>
              <div className="space-y-1">
                <p className="text-sm font-medium">Check your inbox</p>
                <p className="text-sm text-muted-foreground">
                  We sent a verification link to <span className="font-medium">{pendingEmail}</span>. Click it
                  to activate your studio, then sign in.
                </p>
              </div>
              {resent ? (
                <p className="text-sm text-success">Verification email sent again.</p>
              ) : (
                <Button variant="outline" className="w-full" disabled={busy} onClick={() => void resend()}>
                  {busy ? 'Sending…' : 'Resend email'}
                </Button>
              )}
              <button
                type="button"
                onClick={() => {
                  setPendingEmail(null)
                  setResent(false)
                  setMode('signin')
                }}
                className="text-sm font-medium text-primary hover:underline"
              >
                Back to sign in
              </button>
            </CardContent>
          </Card>
        ) : (
          <>
            <Card>
              <CardContent className="p-6">
                <form onSubmit={onSubmit} className="flex flex-col gap-4">
                  {mode === 'register' && (
                    <>
                      <Field label="Studio name">
                        <Input
                          placeholder="e.g. Aperture Studios"
                          value={companyName}
                          onChange={(e) => setCompanyName(e.target.value)}
                          required
                        />
                      </Field>
                      <Field label="Your name">
                        <Input
                          placeholder="e.g. Priya Sharma"
                          value={adminName}
                          onChange={(e) => setAdminName(e.target.value)}
                          required
                        />
                      </Field>
                    </>
                  )}
                  <Field label="Email">
                    <Input
                      type="email"
                      placeholder="you@studio.in"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      required
                    />
                  </Field>
                  <Field label="Password">
                    <Input
                      type="password"
                      placeholder="••••••••"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      required
                    />
                  </Field>

                  {error && (
                    <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>
                  )}

                  <Button type="submit" disabled={busy} className="mt-1 w-full">
                    {busy ? 'Please wait…' : mode === 'signin' ? 'Sign in' : 'Create studio'}
                  </Button>
                </form>
              </CardContent>
            </Card>

            <p className="mt-4 text-center text-sm text-muted-foreground">
              {mode === 'signin' ? 'New studio?' : 'Already have an account?'}{' '}
              <button
                type="button"
                onClick={() => setMode(mode === 'signin' ? 'register' : 'signin')}
                className="font-medium text-primary hover:underline"
              >
                {mode === 'signin' ? 'Register' : 'Sign in'}
              </button>
            </p>
          </>
        )}
      </div>
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label>{label}</Label>
      {children}
    </div>
  )
}
