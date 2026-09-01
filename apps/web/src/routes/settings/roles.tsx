import { useState, type FormEvent } from 'react'
import { Link } from '@tanstack/react-router'
import { Pencil, Plus, ShieldCheck, Trash2 } from 'lucide-react'
import type { DirectoryMember, EmployeeRole } from '@ipc/contracts'
import { AuthedPage } from '@/shared/layout/AuthedPage'
import { PageHeader } from '@/shared/layout/page-header'
import { SettingsTabs } from '@/features/settings/SettingsTabs'
import { useAuth } from '@/shared/auth/AuthProvider'
import { Button } from '@/shared/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/shared/ui/card'
import { Dialog, DialogClose, DialogContent, DialogTrigger } from '@/shared/ui/dialog'
import { HowToUse } from '@/shared/ui/how-to-use'
import { Input, Label } from '@/shared/ui/input'
import { StatusBadge } from '@/shared/ui/status-badge'
import { EmptyState, ErrorState, LoadingState } from '@/shared/ui/states'
import { cn } from '@/shared/ui/cn'
import { useConfirm } from '@/shared/ui/confirm'
import {
  useAssignRoles,
  useCreateRole,
  useDeleteRole,
  useDirectory,
  useEmployeeRoles,
  useUpdateRole,
} from '@/features/team/api'

/** "Drone Operator" → "drone_operator", the code the API stores alongside it. */
const toCode = (name: string): string =>
  name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 40)

export function RolesAccessPage() {
  return (
    <AuthedPage module="team_roles">
      <RolesAccess />
    </AuthedPage>
  )
}

function RolesAccess() {
  const { session } = useAuth()
  const roles = useEmployeeRoles()
  const directory = useDirectory()
  const isOwner = !!session?.is_owner

  return (
    <>
      <PageHeader
        title="Roles & Access"
        description="The job roles your studio books people for, and who holds them."
        actions={isOwner ? <RoleDialog /> : undefined}
      />
      <SettingsTabs />

      <HowToUse
        title="Two kinds of role"
        description="Access level decides what someone can see. Job roles decide what they get booked for."
        steps={[
          'Create the job roles your studio actually books.',
          'Assign them to each team member.',
          'Book by role when you plan a shoot.',
        ]}
      />

      <Card className="mt-6">
        <CardHeader className="pb-4">
          <CardTitle>Job roles</CardTitle>
          <CardDescription>Photographer, Editor, Drone Operator — whatever you book.</CardDescription>
        </CardHeader>
        <CardContent>
          {roles.isLoading ? (
            <LoadingState />
          ) : roles.isError ? (
            <ErrorState onRetry={() => void roles.refetch()} />
          ) : !roles.data || roles.data.length === 0 ? (
            <EmptyState
              title="No job roles yet"
              description="Create your first role to start assigning people to shoots by what they do."
              action={isOwner ? <RoleDialog /> : undefined}
            />
          ) : (
            <ul className="divide-y divide-border">
              {roles.data.map((r) => (
                <li key={r.id} className="flex flex-wrap items-center gap-3 py-3 first:pt-0 last:pb-0">
                  <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                    <ShieldCheck className="size-4" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium">{r.type_name}</p>
                    <p className="truncate font-mono text-xs text-muted-foreground">{r.role_code}</p>
                  </div>
                  <StatusBadge>
                    {r.member_count} {r.member_count === 1 ? 'member' : 'members'}
                  </StatusBadge>
                  {isOwner && <RoleRowActions role={r} />}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card className="mt-6">
        <CardHeader className="pb-4">
          <CardTitle>Who holds what</CardTitle>
          <CardDescription>Assign job roles to each member of your team.</CardDescription>
        </CardHeader>
        <CardContent>
          {directory.isLoading ? (
            <LoadingState />
          ) : directory.isError ? (
            <ErrorState onRetry={() => void directory.refetch()} />
          ) : !directory.data || directory.data.length === 0 ? (
            <EmptyState
              title="No team members yet"
              description="Job roles are assigned to people, so there is nobody to assign them to yet."
              action={
                <Button variant="outline" asChild>
                  <Link to="/employees">Go to team directory</Link>
                </Button>
              }
            />
          ) : (
            <ul className="divide-y divide-border">
              {directory.data.map((m) => (
                <li key={m.user_id} className="flex flex-wrap items-center gap-3 py-3 first:pt-0 last:pb-0">
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium">{m.name}</p>
                    <p className="truncate text-sm text-muted-foreground">
                      {m.role_names.length ? m.role_names.join(', ') : 'No job roles'}
                    </p>
                  </div>
                  {isOwner && <AssignDialog member={m} roles={roles.data ?? []} />}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </>
  )
}

function RoleRowActions({ role }: { role: EmployeeRole }) {
  const del = useDeleteRole()
  const confirm = useConfirm()

  async function onDelete() {
    const yes = await confirm({
      title: `Delete the ${role.type_name} role?`,
      description:
        role.member_count > 0
          ? `${role.member_count} member${role.member_count === 1 ? '' : 's'} will lose this role. Their other roles and bookings stay.`
          : 'Nobody holds this role.',
      confirmLabel: 'Delete',
      destructive: true,
    })
    if (yes) del.mutate(role.id)
  }

  return (
    <div className="flex items-center gap-1">
      <RoleDialog role={role} />
      <Button size="sm" variant="ghost" disabled={del.isPending} onClick={() => void onDelete()}>
        <Trash2 />
        <span className="sr-only">Delete {role.type_name}</span>
      </Button>
    </div>
  )
}

/** Create or rename a job role. The code follows the name unless it's edited. */
function RoleDialog({ role }: { role?: EmployeeRole }) {
  const create = useCreateRole()
  const update = useUpdateRole()
  const editing = !!role
  const [open, setOpen] = useState(false)
  const [name, setName] = useState(role?.type_name ?? '')
  const [code, setCode] = useState(role?.role_code ?? '')
  const [codeTouched, setCodeTouched] = useState(editing)
  const busy = create.isPending || update.isPending

  function onSubmit(e: FormEvent) {
    e.preventDefault()
    const body = { type_name: name.trim(), role_code: (codeTouched ? code : toCode(name)).trim() }
    const done = { onSuccess: () => setOpen(false) }
    if (editing) update.mutate({ id: role.id, patch: body }, done)
    else create.mutate(body, done)
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o)
        if (!o && !editing) {
          setName('')
          setCode('')
          setCodeTouched(false)
        }
      }}
    >
      <DialogTrigger asChild>
        {editing ? (
          <Button size="sm" variant="ghost">
            <Pencil />
            <span className="sr-only">Edit {role.type_name}</span>
          </Button>
        ) : (
          <Button>
            <Plus /> New role
          </Button>
        )}
      </DialogTrigger>
      <DialogContent
        title={editing ? `Edit ${role.type_name}` : 'New job role'}
        description="The code is what other parts of the system store; the name is what people read."
      >
        <form onSubmit={onSubmit} className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <Label>Name</Label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Photographer"
              autoFocus
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>Code</Label>
            <Input
              value={codeTouched ? code : toCode(name)}
              onChange={(e) => {
                setCodeTouched(true)
                setCode(e.target.value)
              }}
              placeholder="photographer"
              className="font-mono"
            />
            <p className="text-xs text-muted-foreground">
              Lowercase letters, numbers and underscores.
            </p>
          </div>
          <div className="flex justify-end gap-2">
            <DialogClose asChild>
              <Button type="button" variant="outline">
                Cancel
              </Button>
            </DialogClose>
            <Button type="submit" disabled={busy || name.trim().length < 2}>
              {busy ? 'Saving…' : editing ? 'Save role' : 'Create role'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function AssignDialog({ member, roles }: { member: DirectoryMember; roles: EmployeeRole[] }) {
  const assign = useAssignRoles()
  const [open, setOpen] = useState(false)
  const [selected, setSelected] = useState<string[]>(member.role_ids)

  const toggle = (id: string) =>
    setSelected((s) => (s.includes(id) ? s.filter((r) => r !== id) : [...s, id]))

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o)
        if (o) setSelected(member.role_ids)
      }}
    >
      <DialogTrigger asChild>
        <Button size="sm" variant="outline">
          Manage roles
        </Button>
      </DialogTrigger>
      <DialogContent title={`Job roles for ${member.name}`} description="Pick everything they can be booked for.">
        {roles.length === 0 ? (
          <p className="text-sm text-muted-foreground">Create a job role first.</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {roles.map((r) => {
              const on = selected.includes(r.id)
              return (
                <button
                  key={r.id}
                  type="button"
                  onClick={() => toggle(r.id)}
                  aria-pressed={on}
                  className={cn(
                    'rounded-full border px-3 py-1.5 text-sm transition-colors',
                    on
                      ? 'border-primary bg-primary/10 text-primary'
                      : 'border-border text-muted-foreground hover:border-primary/40 hover:text-foreground',
                  )}
                >
                  {r.type_name}
                </button>
              )
            })}
          </div>
        )}
        <div className="mt-6 flex justify-end gap-2">
          <DialogClose asChild>
            <Button type="button" variant="outline">
              Cancel
            </Button>
          </DialogClose>
          <Button
            disabled={assign.isPending}
            onClick={() =>
              assign.mutate(
                { userId: member.user_id, roles: { role_ids: selected } },
                { onSuccess: () => setOpen(false) },
              )
            }
          >
            {assign.isPending ? 'Saving…' : 'Save roles'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
