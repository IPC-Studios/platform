import { useState, type FormEvent } from 'react'
import { Link, useNavigate } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { Camera, XCircle } from 'lucide-react'
import { authToken, invitationPreview } from '@ipc/contracts'
import { callApi } from '@/shared/api/client'
import { setTokens } from '@/shared/auth/token'
import { useAuth } from '@/shared/auth/AuthProvider'
import { Button } from '@/shared/ui/button'
import { Card, CardContent } from '@/shared/ui/card'
import { Input, Label } from '@/shared/ui/input'
import { humanize } from '@/shared/ui/format'
import { LoadingState } from '@/shared/ui/states'

/**
 * Landing page for an invitation link (/accept-invite?token=…).
 *
 * The invitee has no account yet, so this is the one screen that creates one
 * without a sign-up form: the studio already filled in who they are, and all
 * that's left is a password. Following the link proved they own the mailbox,
 * so accepting signs them straight in.
 */
export function AcceptInvitePage() {
  const { refresh } = useAuth()
  const navigate = useNavigate()
  const token = new URLSearchParams(window.location.search).get('token')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const preview = useQuery({
    queryKey: ['invite', token],
    queryFn: () =>
      callApi(`/auth/invite?token=${encodeURIComponent(token ?? '')}`, {
        responseSchema: invitationPreview,
      }),
    enabled: !!token,
    retry: false,
  })

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    if (password.length < 6) {
      setError('Use at least 6 characters.')
      return
    }
    if (password !== confirmPassword) {
      setError('Passwords do not match.')
      return
    }
    setBusy(true)
    try {
      setTokens(
        await callApi('/auth/accept-invite', {
          method: 'POST',
          body: { token, password },
          responseSchema: authToken,
        }),
      )
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
          <span className="flex size-11 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            <Camera className="size-6" />
          </span>
          <h1 className="text-xl font-semibold tracking-tight">
            <span className="text-brand">IPC</span> Studios
          </h1>
        </div>

        <Card>
          <CardContent className="p-6">
            {!token || preview.isError ? (
              <div className="flex flex-col items-center gap-3 text-center">
                <XCircle className="size-8 text-destructive" />
                <p className="font-medium">This invitation link doesn’t work</p>
                <p className="text-sm text-muted-foreground">
                  It may have expired, been revoked, or already been used. Ask the studio to send a
                  new one.
                </p>
                <Link to="/login" className="text-sm text-primary hover:underline">
                  Go to sign in
                </Link>
              </div>
            ) : preview.isLoading ? (
              <LoadingState label="Checking your invitation…" />
            ) : (
              <>
                <h2 className="text-lg font-semibold tracking-tight">
                  Join {preview.data?.company_name}
                </h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  You’re joining as {humanize(preview.data?.role ?? 'employee')}. Choose a password
                  for {preview.data?.email}.
                </p>

                <form onSubmit={onSubmit} className="mt-5 flex flex-col gap-3">
                  <div className="flex flex-col gap-1.5">
                    <Label>Password</Label>
                    <Input
                      type="password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="At least 6 characters"
                      autoComplete="new-password"
                      autoFocus
                    />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <Label>Confirm password</Label>
                    <Input
                      type="password"
                      value={confirmPassword}
                      onChange={(e) => setConfirmPassword(e.target.value)}
                      autoComplete="new-password"
                    />
                  </div>
                  {error && <p className="text-sm text-destructive">{error}</p>}
                  <Button type="submit" disabled={busy}>
                    {busy ? 'Setting up…' : 'Accept invitation'}
                  </Button>
                </form>
              </>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
