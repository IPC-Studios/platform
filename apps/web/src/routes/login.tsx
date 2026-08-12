import { useState, type FormEvent } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { Camera } from 'lucide-react'
import { authToken } from '@ipc/contracts'
import { callApi } from '@/shared/api/client'
import { setToken } from '@/shared/auth/token'
import { MOCK_ENABLED } from '@/shared/dev/mock'
import { useAuth } from '@/shared/auth/AuthProvider'
import { Button } from '@/shared/ui/button'
import { Card, CardContent } from '@/shared/ui/card'
import { Input, Label } from '@/shared/ui/input'

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
      if (MOCK_ENABLED) {
        // Preview mode: no backend — the mock session is injected on refresh.
        await refresh()
        await navigate({ to: '/dashboard' })
        return
      }
      const { access_token } =
        mode === 'signin'
          ? await callApi('/auth/login', {
              method: 'POST',
              body: { email, password },
              responseSchema: authToken,
            })
          : await callApi('/auth/register', {
              method: 'POST',
              body: { company_name: companyName, admin_name: adminName, email, password },
              responseSchema: authToken,
            })
      setToken(access_token)
      await refresh()
      await navigate({ to: '/dashboard' })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong.')
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
          <h1 className="text-xl font-semibold tracking-tight">IPC Studios</h1>
          <p className="text-sm text-muted-foreground">
            {mode === 'signin' ? 'Sign in to your studio workspace.' : 'Create your studio workspace.'}
          </p>
        </div>

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
          {mode === 'signin' ? "New studio?" : 'Already have an account?'}{' '}
          <button
            type="button"
            onClick={() => setMode(mode === 'signin' ? 'register' : 'signin')}
            className="font-medium text-primary hover:underline"
          >
            {mode === 'signin' ? 'Register' : 'Sign in'}
          </button>
        </p>
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
