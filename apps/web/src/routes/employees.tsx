import { useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Plus, Users, Copy, Check, KeyRound } from 'lucide-react'
import { toast } from 'sonner'
import { z, directoryMember, addMemberResponse, type AddMemberRequest } from '@ipc/contracts'
import { callApi } from '@/shared/api/client'
import { useAuth } from '@/shared/auth/AuthProvider'
import { useAccess } from '@/shared/auth/useAccess'
import { AuthedPage } from '@/shared/layout/AuthedPage'
import { PageHeader } from '@/shared/layout/page-header'
import { Button } from '@/shared/ui/button'
import { Dialog, DialogClose, DialogContent, DialogTrigger } from '@/shared/ui/dialog'
import { Input, Label, Select } from '@/shared/ui/input'
import { StatusBadge } from '@/shared/ui/status-badge'
import { LoadingState, ErrorState, EmptyState } from '@/shared/ui/states'
import { humanize } from '@/shared/ui/format'
import { useConfirm } from '@/shared/ui/confirm'

const list = directoryMember.array()
const ok = z.object({ ok: z.boolean() })
const ROLE_TONE: Record<string, 'info' | 'success' | 'warning' | 'neutral'> = {
  super_admin: 'success',
  admin: 'info',
  manager: 'warning',
  employee: 'neutral',
}

function useDirectory() {
  const { session } = useAuth()
  const access = useAccess()
  return useQuery({
    queryKey: ['team', 'directory'],
    queryFn: () => callApi('/team/directory', { responseSchema: list }),
    enabled: !!session && access.hasModule('team_directory'),
    staleTime: 30_000,
  })
}

export function EmployeesPage() {
  return (
    <AuthedPage module="team_directory">
      <Directory />
    </AuthedPage>
  )
}

function Directory() {
  const { data, isLoading, isError, refetch } = useDirectory()
  const { session } = useAuth()

  return (
    <>
      <PageHeader
        title="Team"
        description="Everyone in your studio."
        actions={session?.is_owner && <AddMemberDialog />}
      />
      {isLoading ? (
        <LoadingState />
      ) : isError ? (
        <ErrorState onRetry={() => void refetch()} />
      ) : !data || data.length === 0 ? (
        <EmptyState title="No team members" description="Add your first team member to get started." />
      ) : (
        <div className="overflow-hidden rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-left text-muted-foreground">
              <tr>
                <th className="px-4 py-2 font-medium">Name</th>
                <th className="px-4 py-2 font-medium">Email</th>
                <th className="px-4 py-2 font-medium">Phone</th>
                <th className="px-4 py-2 font-medium">Role</th>
                {session?.is_owner && (
                  <th className="px-4 py-2 font-medium">
                    <span className="sr-only">Actions</span>
                  </th>
                )}
              </tr>
            </thead>
            <tbody>
              {data.map((m) => (
                <tr key={m.user_id} className="border-t border-border">
                  <td className="px-4 py-2 font-medium">
                    <span className="flex items-center gap-2">
                      <Users className="size-4 text-muted-foreground" />
                      {m.name}
                    </span>
                  </td>
                  <td className="px-4 py-2 text-muted-foreground">{m.email}</td>
                  <td className="px-4 py-2 text-muted-foreground">{m.phone ?? '—'}</td>
                  <td className="px-4 py-2">
                    <StatusBadge tone={ROLE_TONE[m.role] ?? 'neutral'}>{humanize(m.role)}</StatusBadge>
                  </td>
                  {session?.is_owner && (
                    <td className="px-4 py-2 text-right">
                      <SendResetButton userId={m.user_id} name={m.name} />
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  )
}

/** Owner-only: email a member a reset link instead of handling their password. */
function SendResetButton({ userId, name }: { userId: string; name: string }) {
  const confirm = useConfirm()
  const send = useMutation({
    mutationFn: () =>
      callApi(`/team/members/${userId}/reset-password`, { method: 'POST', responseSchema: ok }),
    onSuccess: () => toast.success(`Reset link sent to ${name}.`),
    onError: (e: Error) => toast.error(e.message),
  })

  async function onClick() {
    const yes = await confirm({
      title: `Send ${name} a password reset link?`,
      description:
        'They get an email with a one-time link that expires in 1 hour. Their current password keeps working until they use it.',
      confirmLabel: 'Send link',
    })
    if (yes) send.mutate()
  }

  return (
    <Button variant="ghost" size="sm" disabled={send.isPending} onClick={() => void onClick()}>
      <KeyRound className="size-4" />
      {send.isPending ? 'Sending…' : 'Reset password'}
    </Button>
  )
}

function AddMemberDialog() {
  const qc = useQueryClient()
  const add = useMutation({
    mutationFn: (input: AddMemberRequest) =>
      callApi('/team/members', { method: 'POST', body: input, responseSchema: addMemberResponse }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['team'] }),
  })
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [role, setRole] = useState<'admin' | 'manager' | 'employee'>('employee')
  const [phone, setPhone] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [temp, setTemp] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  function reset() {
    setName('')
    setEmail('')
    setRole('employee')
    setPhone('')
    setError(null)
    setTemp(null)
    setCopied(false)
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    try {
      const res = await add.mutateAsync({
        name: name.trim(),
        email: email.trim(),
        role,
        ...(phone.trim() ? { phone: phone.trim() } : {}),
      })
      setTemp(res.temp_password)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not add the member.')
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o)
        if (!o) reset()
      }}
    >
      <DialogTrigger asChild>
        <Button>
          <Plus /> Add member
        </Button>
      </DialogTrigger>
      <DialogContent title="Add team member" description="They can sign in with the temporary password.">
        {temp ? (
          <div className="flex flex-col gap-3">
            <p className="text-sm">
              <span className="font-medium">{name}</span> was added. Share these credentials — they can
              change the password after signing in.
            </p>
            <div className="rounded-md border border-border bg-muted/40 p-3 text-sm">
              <p>
                <span className="text-muted-foreground">Email:</span> {email}
              </p>
              <div className="mt-1 flex items-center justify-between gap-2">
                <span>
                  <span className="text-muted-foreground">Temp password:</span>{' '}
                  <code className="font-mono">{temp}</code>
                </span>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    void navigator.clipboard.writeText(`${email} / ${temp}`)
                    setCopied(true)
                  }}
                >
                  {copied ? <Check /> : <Copy />} {copied ? 'Copied' : 'Copy'}
                </Button>
              </div>
            </div>
            <div className="flex justify-end">
              <DialogClose asChild>
                <Button>Done</Button>
              </DialogClose>
            </div>
          </div>
        ) : (
          <form onSubmit={onSubmit} className="flex flex-col gap-3">
            <div className="flex flex-col gap-1.5">
              <Label>Name</Label>
              <Input value={name} onChange={(e) => setName(e.target.value)} required autoFocus />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-1.5">
                <Label>Email</Label>
                <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label>Role</Label>
                <Select value={role} onChange={(e) => setRole(e.target.value as typeof role)}>
                  <option value="employee">Employee</option>
                  <option value="manager">Manager</option>
                  <option value="admin">Admin</option>
                </Select>
              </div>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>Phone</Label>
              <Input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="Optional" />
            </div>
            {error && <p className="text-sm text-destructive">{error}</p>}
            <div className="flex justify-end gap-2">
              <DialogClose asChild>
                <Button type="button" variant="outline">
                  Cancel
                </Button>
              </DialogClose>
              <Button type="submit" disabled={add.isPending}>
                {add.isPending ? 'Adding…' : 'Add member'}
              </Button>
            </div>
          </form>
        )}
      </DialogContent>
    </Dialog>
  )
}
