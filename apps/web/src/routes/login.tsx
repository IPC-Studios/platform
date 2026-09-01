import { useId, useRef, useState, type FormEvent } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { MailCheck } from 'lucide-react'
import { toast } from 'sonner'
import {
  z,
  authToken,
  registerRequest,
  registerResult,
  loginRequest,
  forgotPasswordRequest,
  forgotPasswordResult,
} from '@ipc/contracts'
import { callApi, ApiError } from '@/shared/api/client'
import { fieldErrors, type FieldErrors } from '@/shared/forms/field-errors'
import { setTokens } from '@/shared/auth/token'
import { MOCK_ENABLED } from '@/shared/dev/mock'
import { useAuth } from '@/shared/auth/AuthProvider'
import { Button } from '@/shared/ui/button'
import { Card, CardContent } from '@/shared/ui/card'
import { Input, Label } from '@/shared/ui/input'
import { TiltCard } from '@/shared/ui/tilt-card'
import { CameraBackdrop } from '@/shared/brand/CameraBackdrop'

type Mode = 'signin' | 'register' | 'forgot'
const ok = z.object({ ok: z.boolean() })

/** Every field any of the three modes can show, plus the one the API has no say in. */
type FieldName = 'company_name' | 'admin_name' | 'email' | 'phone' | 'password' | 'confirm_password'

const LABELS: Record<FieldName, string> = {
  company_name: 'Company name',
  admin_name: 'Your name',
  email: 'Email',
  phone: 'Phone',
  password: 'Password',
  confirm_password: 'Confirm password',
}

const OVERRIDES: Partial<Record<FieldName, string | undefined>> = {
  // The contract's phone message ("invalid phone number") says what is wrong but
  // not what to do; every phone failure is the same failure, so one sentence covers it.
  phone: 'Enter a valid phone number — 10 digits, or with a country code.',
}

/** The wiring a Field hands its control so label, error and input stay tied together. */
interface ControlProps {
  id: string
  name: string
  'aria-invalid'?: true | undefined
  'aria-describedby'?: string | undefined
}

/** Focus order for the jump-to-first-problem on submit; matches the visual order. */
const FIELD_ORDER: FieldName[] = [
  'company_name',
  'admin_name',
  'email',
  'phone',
  'password',
  'confirm_password',
]

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
  const [errors, setErrors] = useState<FieldErrors<FieldName>>({})
  const [busy, setBusy] = useState(false)
  const formRef = useRef<HTMLFormElement>(null)
  // Set once the user needs to verify their email (after register, or a 403 login).
  const [pendingEmail, setPendingEmail] = useState<string | null>(null)
  const [resent, setResent] = useState(false)
  // Set once a reset link has been requested (shown regardless of whether the
  // account exists — the API never tells us).
  const [resetSentTo, setResetSentTo] = useState<string | null>(null)

  const isRegister = mode === 'register'
  const isForgot = mode === 'forgot'

  /**
   * The payload as the API would receive it, so the form is checked against the
   * exact same object the server will parse. Phone is omitted when blank because
   * the contract treats it as optional-but-valid-if-present.
   */
  function payload(): Record<string, unknown> {
    if (isForgot) return { email }
    if (isRegister) {
      return {
        company_name: companyName,
        admin_name: adminName,
        email,
        password,
        ...(phone.trim() ? { phone: phone.trim() } : {}),
      }
    }
    return { email, password }
  }

  const schema = isForgot ? forgotPasswordRequest : isRegister ? registerRequest : loginRequest

  /** Contract failures, plus the confirm-password rule the API has no opinion on. */
  function validate(): FieldErrors<FieldName> {
    const found = fieldErrors<FieldName>(schema, payload(), {
      labels: LABELS,
      overrides: OVERRIDES,
    })
    if (isRegister && !found.password) {
      if (!confirmPassword) found.confirm_password = 'Please re-type your password.'
      else if (password !== confirmPassword) found.confirm_password = 'Passwords do not match.'
    }
    return found
  }

  /** Re-check one field once the user leaves it — but never nag about a blank one. */
  function validateField(field: FieldName, value: string) {
    if (!value.trim()) return setErrors((prev) => ({ ...prev, [field]: undefined }))
    setErrors((prev) => ({ ...prev, [field]: validate()[field] }))
  }

  /** Switching tabs must not carry the previous form's complaints across. */
  function switchMode(next: Mode) {
    setMode(next)
    setErrors({})
    setError(null)
    setPassword('')
    setConfirmPassword('')
  }

  /** Editing a field clears its complaint; submitting decides whether it comes back. */
  function edit(field: FieldName, set: (v: string) => void) {
    return (e: React.ChangeEvent<HTMLInputElement>) => {
      set(e.target.value)
      setErrors((prev) => (prev[field] ? { ...prev, [field]: undefined } : prev))
      setError(null)
    }
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)

    const found = validate()
    setErrors(found)
    if (Object.values(found).some(Boolean)) {
      // Land the cursor on the first problem rather than making them hunt for it.
      const first = FIELD_ORDER.find((f) => found[f])
      formRef.current?.querySelector<HTMLInputElement>(`[name="${first}"]`)?.focus()
      return
    }

    setBusy(true)
    try {
      if (isForgot) {
        await callApi('/auth/forgot-password', {
          method: 'POST',
          body: payload(),
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
          body: payload(),
          responseSchema: registerResult,
        })
        setPendingEmail(email) // show the "check your inbox" screen
        return
      }
      setTokens(
        await callApi('/auth/login', {
          method: 'POST',
          body: payload(),
          responseSchema: authToken,
        }),
      )
      await refresh()
      await navigate({ to: '/dashboard' })
    } catch (err) {
      // A 403 on sign-in means the email isn't verified yet.
      if (err instanceof ApiError && err.status === 403) {
        setPendingEmail(email)
        return
      }
      // "Email already taken" is a fact about one field, so it belongs under
      // that field rather than in a banner the user has to map back themselves.
      if (err instanceof ApiError && err.status === 409 && /email/i.test(err.message)) {
        setErrors((prev) => ({ ...prev, email: err.message }))
        formRef.current?.querySelector<HTMLInputElement>('[name="email"]')?.focus()
        return
      }
      setError(err instanceof Error ? err.message : 'Something went wrong.')
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
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-muted/40 p-4">
      <CameraBackdrop />

      <TiltCard className="relative w-full max-w-md" max={3} sheen={false}>
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
                  If an account exists for <span className="font-medium">{resetSentTo}</span>, we've
                  sent a link to reset the password. It expires in 1 hour.
                </p>
              </div>
              <button
                type="button"
                onClick={() => {
                  setResetSentTo(null)
                  switchMode('signin')
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
                  We sent a verification link to <span className="font-medium">{pendingEmail}</span>
                  . Click it to activate your studio, then sign in.
                </p>
              </div>
              {resent ? (
                <p className="text-sm text-success">Verification email sent again.</p>
              ) : (
                <Button
                  variant="outline"
                  className="w-full"
                  disabled={busy}
                  onClick={() => void resend()}
                >
                  {busy ? 'Sending…' : 'Resend email'}
                </Button>
              )}
              <button
                type="button"
                onClick={() => {
                  setPendingEmail(null)
                  setResent(false)
                  switchMode('signin')
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
                    {isForgot
                      ? 'Forgot password'
                      : isRegister
                        ? 'Create your account'
                        : 'Welcome back'}
                  </h2>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {isForgot
                      ? "Enter your email and we'll send a reset link"
                      : isRegister
                        ? 'Start your studio workspace'
                        : 'Sign in to your studio workspace'}
                  </p>
                </div>

                {/* noValidate: the browser's own bubbles ("Please fill out this
                    field") would fire first and hide the specific messages below. */}
                <form ref={formRef} onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
                  {isRegister && (
                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                      <Field label="Company name" name="company_name" error={errors.company_name}>
                        {(p) => (
                          <Input
                            {...p}
                            placeholder="e.g. Aperture Studios"
                            value={companyName}
                            onChange={edit('company_name', setCompanyName)}
                            onBlur={(e) => validateField('company_name', e.target.value)}
                            required
                          />
                        )}
                      </Field>
                      <Field label="Your name" name="admin_name" error={errors.admin_name}>
                        {(p) => (
                          <Input
                            {...p}
                            placeholder="e.g. Priya Sharma"
                            value={adminName}
                            onChange={edit('admin_name', setAdminName)}
                            onBlur={(e) => validateField('admin_name', e.target.value)}
                            required
                          />
                        )}
                      </Field>
                    </div>
                  )}

                  <Field label="Email" name="email" error={errors.email}>
                    {(p) => (
                      <Input
                        {...p}
                        type="email"
                        autoComplete="email"
                        placeholder="you@studio.in"
                        value={email}
                        onChange={edit('email', setEmail)}
                        onBlur={(e) => validateField('email', e.target.value)}
                        required
                      />
                    )}
                  </Field>

                  {isRegister && (
                    <Field
                      label="Phone"
                      name="phone"
                      error={errors.phone}
                      hint="Optional — 10 digits, or with a country code."
                    >
                      {(p) => (
                        <Input
                          {...p}
                          type="tel"
                          autoComplete="tel"
                          placeholder="98765 43210"
                          value={phone}
                          onChange={edit('phone', setPhone)}
                          onBlur={(e) => validateField('phone', e.target.value)}
                        />
                      )}
                    </Field>
                  )}

                  {isRegister ? (
                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                      <Field
                        label="Password"
                        name="password"
                        error={errors.password}
                        hint="At least 8 characters."
                      >
                        {(p) => (
                          <Input
                            {...p}
                            type="password"
                            autoComplete="new-password"
                            placeholder="••••••••"
                            value={password}
                            onChange={edit('password', setPassword)}
                            onBlur={(e) => validateField('password', e.target.value)}
                            required
                          />
                        )}
                      </Field>
                      <Field
                        label="Confirm password"
                        name="confirm_password"
                        error={errors.confirm_password}
                      >
                        {(p) => (
                          <Input
                            {...p}
                            type="password"
                            autoComplete="new-password"
                            placeholder="••••••••"
                            value={confirmPassword}
                            onChange={edit('confirm_password', setConfirmPassword)}
                            onBlur={() => {
                              // Compared, not format-checked — only meaningful once
                              // both boxes have something in them.
                              if (confirmPassword && password !== confirmPassword) {
                                setErrors((prev) => ({
                                  ...prev,
                                  confirm_password: 'Passwords do not match.',
                                }))
                              }
                            }}
                            required
                          />
                        )}
                      </Field>
                    </div>
                  ) : (
                    !isForgot && (
                      <Field
                        label="Password"
                        name="password"
                        error={errors.password}
                        action={
                          <button
                            type="button"
                            onClick={() => switchMode('forgot')}
                            className="text-xs font-medium text-primary hover:underline"
                          >
                            Forgot password?
                          </button>
                        }
                      >
                        {(p) => (
                          <Input
                            {...p}
                            type="password"
                            autoComplete="current-password"
                            placeholder="••••••••"
                            value={password}
                            onChange={edit('password', setPassword)}
                            required
                          />
                        )}
                      </Field>
                    )
                  )}

                  {error && (
                    <p
                      role="alert"
                      className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive"
                    >
                      {error}
                    </p>
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
                    switchMode('signin')
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
                      switchMode(isRegister ? 'signin' : 'register')
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
      </TiltCard>
    </div>
  )
}

/**
 * A labelled input with its own error slot. The error replaces the hint rather
 * than stacking under it, and is tied to the control by aria-describedby so it
 * is announced instead of just being red.
 */
function Field({
  label,
  name,
  error,
  hint,
  action,
  children,
}: {
  label: string
  name: string
  error?: string | undefined
  hint?: string | undefined
  /** Optional control on the label row, e.g. "Forgot password?". */
  action?: React.ReactNode
  /** Given the id/aria wiring this field owns, so the control cannot forget it. */
  children: (props: ControlProps) => React.ReactNode
}) {
  const id = useId()
  const messageId = `${id}-message`

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between">
        <Label htmlFor={id}>{label}</Label>
        {action}
      </div>
      {children({
        id,
        name,
        'aria-invalid': error ? true : undefined,
        'aria-describedby': error || hint ? messageId : undefined,
      })}
      {error ? (
        <p id={messageId} role="alert" className="text-xs font-medium text-destructive">
          {error}
        </p>
      ) : hint ? (
        <p id={messageId} className="text-xs text-muted-foreground">
          {hint}
        </p>
      ) : null}
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
