import { useState, type FormEvent } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { MailCheck } from 'lucide-react'
import { toast } from 'sonner'
import { z, authToken, registerResult, forgotPasswordResult } from '@ipc/contracts'
import { callApi, ApiError } from '@/shared/api/client'
import { setTokens } from '@/shared/auth/token'
import { MOCK_ENABLED } from '@/shared/dev/mock'
import { useAuth } from '@/shared/auth/AuthProvider'
import { Button } from '@/shared/ui/button'
import { Card, CardContent } from '@/shared/ui/card'
import { Input, Label } from '@/shared/ui/input'

type Mode = 'signin' | 'register' | 'forgot'
const ok = z.object({ ok: z.boolean() })

export function LoginPage() {
  const { refresh } = useAuth()
  const navigate = useNavigate()
  const [mode, setMode] = useState<Mode>('signin')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [companyName, setCompanyName] = useState('')
  const [adminName, setAdminName] = useState('')
  const [phone, setPhone] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  // Set once the user needs to verify their email (after register, or a 403 login).
  const [pendingEmail, setPendingEmail] = useState<string | null>(null)
  const [resent, setResent] = useState(false)
  // Set once a reset link has been requested (shown regardless of whether the
  // account exists — the API never tells us).
  const [resetSentTo, setResetSentTo] = useState<string | null>(null)

  const isRegister = mode === 'register'
  const isForgot = mode === 'forgot'

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    if (isRegister && password !== confirmPassword) {
      setError('Passwords do not match.')
      return
    }
    setBusy(true)
    try {
      if (isForgot) {
        await callApi('/auth/forgot-password', {
          method: 'POST',
          body: { email },
          responseSchema: forgotPasswordResult,
        })
        setResetSentTo(email)
        return
      }
      if (MOCK_ENABLED) {
        await refresh()
        await navigate({ to: '/dashboard' })
        return
      }
      if (isRegister) {
        await callApi('/auth/register', {
          method: 'POST',
          body: {
            company_name: companyName,
            admin_name: adminName,
            email,
            password,
            ...(phone.trim() ? { phone: phone.trim() } : {}),
          },
          responseSchema: registerResult,
        })
        setPendingEmail(email) // show the "check your inbox" screen
        return
      }
      setTokens(
        await callApi('/auth/login', {
          method: 'POST',
          body: { email, password },
          responseSchema: authToken,
        }),
      )
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
      <div className="w-full max-w-md">
        <h1 className="mb-6 text-center text-2xl font-bold tracking-tight">
          <span className="text-brand">IPC</span> Studios
        </h1>

        {resetSentTo ? (
          <Card>
            <CardContent className="flex flex-col items-center gap-4 p-6 text-center">
              <span className="flex size-11 items-center justify-center rounded-full bg-primary/10 text-primary">
                <MailCheck className="size-6" />
              </span>
              <div className="space-y-1">
                <p className="text-sm font-medium">Check your inbox</p>
                <p className="text-sm text-muted-foreground">
                  If an account exists for <span className="font-medium">{resetSentTo}</span>, we've sent a
                  link to reset the password. It expires in 1 hour.
                </p>
              </div>
              <button
                type="button"
                onClick={() => {
                  setResetSentTo(null)
                  setPassword('')
                  setMode('signin')
                }}
                className="text-sm font-medium text-primary hover:underline"
              >
                Back to sign in
              </button>
            </CardContent>
          </Card>
        ) : pendingEmail ? (
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
              <CardContent className="p-6 sm:p-8">
                <div className="mb-6">
                  <h2 className="text-2xl font-bold tracking-tight">
                    {isForgot ? 'Forgot password' : isRegister ? 'Create your account' : 'Welcome back'}
                  </h2>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {isForgot
                      ? "Enter your email and we'll send a reset link"
                      : isRegister
                        ? 'Start your studio workspace'
                        : 'Sign in to your studio workspace'}
                  </p>
                </div>

                <form onSubmit={onSubmit} className="flex flex-col gap-4">
                  {isRegister && (
                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                      <Field label="Company name">
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
                    </div>
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

                  {isRegister && (
                    <Field label="Phone">
                      <Input
                        type="tel"
                        placeholder="98765 43210"
                        value={phone}
                        onChange={(e) => setPhone(e.target.value)}
                      />
                    </Field>
                  )}

                  {isRegister ? (
                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                      <Field label="Password">
                        <Input
                          type="password"
                          placeholder="••••••••"
                          value={password}
                          onChange={(e) => setPassword(e.target.value)}
                          required
                        />
                      </Field>
                      <Field label="Confirm password">
                        <Input
                          type="password"
                          placeholder="••••••••"
                          value={confirmPassword}
                          onChange={(e) => setConfirmPassword(e.target.value)}
                          required
                        />
                      </Field>
                    </div>
                  ) : (
                    !isForgot && (
                      <div className="flex flex-col gap-1.5">
                        <div className="flex items-center justify-between">
                          <Label>Password</Label>
                          <button
                            type="button"
                            onClick={() => {
                              setMode('forgot')
                              setError(null)
                              setPassword('')
                            }}
                            className="text-xs font-medium text-primary hover:underline"
                          >
                            Forgot password?
                          </button>
                        </div>
                        <Input
                          type="password"
                          placeholder="••••••••"
                          value={password}
                          onChange={(e) => setPassword(e.target.value)}
                          required
                        />
                      </div>
                    )
                  )}

                  {error && (
                    <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>
                  )}

                  <Button type="submit" disabled={busy} className="mt-1 w-full">
                    {busy
                      ? 'Please wait…'
                      : isForgot
                        ? 'Send reset link'
                        : isRegister
                          ? 'Create account'
                          : 'Sign in'}
                  </Button>
                </form>

                {!isForgot && (
                  <>
                    <div className="my-5 flex items-center gap-3 text-xs text-muted-foreground">
                      <span className="h-px flex-1 bg-border" />
                      or
                      <span className="h-px flex-1 bg-border" />
                    </div>

                    <Button
                      type="button"
                      variant="outline"
                      className="w-full"
                      onClick={() => toast('Google sign-in is coming soon.')}
                    >
                      <GoogleIcon />
                      Continue with Google
                    </Button>
                  </>
                )}
              </CardContent>
            </Card>

            <p className="mt-4 text-center text-sm text-muted-foreground">
              {isForgot ? (
                <button
                  type="button"
                  onClick={() => {
                    setMode('signin')
                    setError(null)
                  }}
                  className="font-medium text-primary hover:underline"
                >
                  Back to sign in
                </button>
              ) : (
                <>
                  {isRegister ? 'Already have an account?' : 'New studio?'}{' '}
                  <button
                    type="button"
                    onClick={() => {
                      setMode(isRegister ? 'signin' : 'register')
                      setError(null)
                    }}
                    className="font-medium text-primary hover:underline"
                  >
                    {isRegister ? 'Sign in' : 'Register'}
                  </button>
                </>
              )}
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

function GoogleIcon() {
  return (
    <svg viewBox="0 0 24 24" className="size-4" aria-hidden="true">
      <path
        fill="#4285F4"
        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.27-4.74 3.27-8.1Z"
      />
      <path
        fill="#34A853"
        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84A11 11 0 0 0 12 23Z"
      />
      <path
        fill="#FBBC05"
        d="M5.84 14.1a6.6 6.6 0 0 1 0-4.2V7.06H2.18a11 11 0 0 0 0 9.88l3.66-2.84Z"
      />
      <path
        fill="#EA4335"
        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1A11 11 0 0 0 2.18 7.06l3.66 2.84C6.71 7.3 9.14 5.38 12 5.38Z"
      />
    </svg>
  )
}
