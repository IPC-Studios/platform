import { useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Camera, Plus, MapPin, Pencil, Trash2, ExternalLink } from 'lucide-react'
import { shootListItem, shootRequirementInput, z, type CreateShootRequest, type ShootListItem, type ShootRequirementInput, type ShootStatus, type UpdateShootRequest } from '@ipc/contracts'
import { toast } from 'sonner'
import { callApi } from '@/shared/api/client'
import { useAuth } from '@/shared/auth/AuthProvider'
import { useAccess } from '@/shared/auth/useAccess'
import { AuthedPage } from '@/shared/layout/AuthedPage'
import { PageHeader } from '@/shared/layout/page-header'
import { Button } from '@/shared/ui/button'
import { SkeletonCards } from '@/shared/ui/skeleton'
import { Card, CardContent } from '@/shared/ui/card'
import { Dialog, DialogClose, DialogContent, DialogTrigger } from '@/shared/ui/dialog'
import { Input, Label, Select } from '@/shared/ui/input'
import { StatusBadge } from '@/shared/ui/status-badge'
import { SendTermsDialog } from '@/features/team-terms/SendTermsDialog'
import { ErrorState, EmptyState } from '@/shared/ui/states'
import { humanize } from '@/shared/ui/format'
import { useProjects } from '@/features/projects/api'
import { useUpdateShoot } from '@/features/shoots/api'

const list = shootListItem.array()
const TONE: Record<ShootStatus, 'info' | 'success' | 'warning' | 'danger'> = {
  planned: 'warning',
  confirmed: 'info',
  completed: 'success',
  cancelled: 'danger',
}

function useShoots() {
  const { session } = useAuth()
  const access = useAccess()
  return useQuery({
    queryKey: ['shoots'],
    queryFn: () => callApi('/shoots', { responseSchema: list }),
    enabled: !!session && access.hasModule('projects'),
    staleTime: 30_000,
  })
}

export function ShootsPage() {
  return (
    <AuthedPage module="projects">
      <Shoots />
    </AuthedPage>
  )
}

function Shoots() {
  const { data, isLoading, isError, refetch } = useShoots()
  const access = useAccess()
  const canEdit = access.hasAction('projects', 'edit')

  return (
    <>
      <PageHeader
        title="Shoots"
        description="Every scheduled shoot across your projects."
        actions={canEdit && <ShootDialog />}
      />
      {isLoading ? (
        <SkeletonCards count={3} />
      ) : isError ? (
        <ErrorState onRetry={() => void refetch()} />
      ) : !data || data.length === 0 ? (
        <EmptyState title="No shoots scheduled" description="Add a shoot to a project to plan crew and data." action={canEdit && <ShootDialog />} />
      ) : (
        <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
          {data.map((s) => (
            <Card key={s.id}>
              <CardContent className="p-4">
                <div className="flex items-start justify-between gap-2">
                  <span className="flex items-center gap-2 font-medium">
                    <Camera className="size-4 text-muted-foreground" />
                    {s.name}
                  </span>
                  <StatusBadge tone={TONE[s.status]}>{humanize(s.status)}</StatusBadge>
                </div>
                <p className="mt-1 text-sm text-muted-foreground">{s.project_name ?? '—'}</p>
                <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                  {s.shoot_date && <span>{s.shoot_date}</span>}
                  {s.location && (
                    <span className="flex items-center gap-1">
                      <MapPin className="size-3" />
                      {s.location}
                    </span>
                  )}
                  {s.map_link && (
                    <a
                      href={s.map_link}
                      target="_blank"
                      rel="noreferrer"
                      className="flex items-center gap-1 text-primary hover:underline"
                    >
                      Map <ExternalLink className="size-3" />
                    </a>
                  )}
                </div>
                {s.requirements.length > 0 && (
                  <p className="mt-1 truncate text-xs text-muted-foreground">
                    Needs: {s.requirements.map((r) => `${r.name} ×${r.quantity}`).join(', ')}
                  </p>
                )}
                {canEdit && (
                  <div className="mt-3 flex items-center gap-2">
                    <EditShootDialog shoot={s} />
                    <SendTermsDialog shoot={s} />
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </>
  )
}

/** A simple add/remove list of "who and what this day needs" — no autocomplete, just name + quantity. */
function RequirementsEditor({ value, onChange }: { value: ShootRequirementInput[]; onChange: (next: ShootRequirementInput[]) => void }) {
  const [name, setName] = useState('')
  const [quantity, setQuantity] = useState(1)

  function add() {
    const trimmed = name.trim()
    if (!trimmed) return
    onChange([...value, { name: trimmed, quantity }])
    setName('')
    setQuantity(1)
  }

  return (
    <div className="flex flex-col gap-2">
      <Label>Requirements (optional)</Label>
      {value.length > 0 && (
        <ul className="flex flex-col gap-1">
          {value.map((r, i) => (
            <li key={i} className="flex items-center justify-between rounded-md border border-border px-2 py-1 text-sm">
              <span>
                {r.name} × {r.quantity}
              </span>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="size-6"
                onClick={() => onChange(value.filter((_, idx) => idx !== i))}
              >
                <Trash2 className="size-3.5" />
              </Button>
            </li>
          ))}
        </ul>
      )}
      <div className="flex gap-2">
        <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Drone pilot" className="flex-1" />
        <Input
          type="number"
          min={1}
          max={99}
          value={quantity}
          onChange={(e) => setQuantity(Number(e.target.value))}
          className="w-16"
        />
        <Button type="button" variant="outline" size="sm" onClick={add} disabled={!name.trim()}>
          Add
        </Button>
      </div>
    </div>
  )
}

function ShootDialog() {
  const qc = useQueryClient()
  const { data: projects } = useProjects()
  const create = useMutation({
    mutationFn: (input: CreateShootRequest) =>
      callApi('/shoots', { method: 'POST', body: input, responseSchema: z.object({ id: z.string() }) }),
    onSuccess: () => {
      toast.success('Shoot added')
      void qc.invalidateQueries({ queryKey: ['shoots'] })
    },
  })
  const [open, setOpen] = useState(false)
  const [projectId, setProjectId] = useState('')
  const [name, setName] = useState('')
  const [date, setDate] = useState('')
  const [location, setLocation] = useState('')
  const [mapLink, setMapLink] = useState('')
  const [requirements, setRequirements] = useState<ShootRequirementInput[]>([])
  const [error, setError] = useState<string | null>(null)

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    try {
      if (!projectId) throw new Error('Pick a project.')
      const body: CreateShootRequest = {
        project_id: projectId,
        name: name.trim(),
        status: 'planned',
        ...(date ? { shoot_date: date } : {}),
        ...(location.trim() ? { location: location.trim() } : {}),
        ...(mapLink.trim() ? { map_link: mapLink.trim() } : {}),
        ...(requirements.length > 0 ? { requirements } : {}),
      }
      await create.mutateAsync(body)
      setOpen(false)
      setName('')
      setDate('')
      setLocation('')
      setMapLink('')
      setRequirements([])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create the shoot.')
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <Plus /> New shoot
        </Button>
      </DialogTrigger>
      <DialogContent title="New shoot" description="Schedule a shoot for a project.">
        <form onSubmit={onSubmit} className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <Label>Project</Label>
            <Select value={projectId} onChange={(e) => setProjectId(e.target.value)} required>
              <option value="">— Select —</option>
              {(projects ?? []).map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </Select>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>Shoot name</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Wedding day" required />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <Label>Date</Label>
              <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>Location</Label>
              <Input value={location} onChange={(e) => setLocation(e.target.value)} placeholder="Venue" />
            </div>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>Map link (optional)</Label>
            <Input value={mapLink} onChange={(e) => setMapLink(e.target.value)} placeholder="https://maps.google.com/…" type="url" />
          </div>
          <RequirementsEditor value={requirements} onChange={setRequirements} />
          {error && (
            <p id="form-error" role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          <div className="flex justify-end gap-2">
            <DialogClose asChild>
              <Button type="button" variant="outline">
                Cancel
              </Button>
            </DialogClose>
            <Button type="submit" disabled={create.isPending}>
              {create.isPending ? 'Creating…' : 'Create shoot'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function EditShootDialog({ shoot }: { shoot: ShootListItem }) {
  const update = useUpdateShoot()
  const [open, setOpen] = useState(false)
  const [name, setName] = useState(shoot.name)
  const [date, setDate] = useState(shoot.shoot_date ?? '')
  const [location, setLocation] = useState(shoot.location ?? '')
  const [mapLink, setMapLink] = useState(shoot.map_link ?? '')
  const [status, setStatus] = useState<ShootStatus>(shoot.status)
  const [requirements, setRequirements] = useState<ShootRequirementInput[]>(
    shoot.requirements.map((r) => ({ name: r.name, quantity: r.quantity })),
  )
  const [error, setError] = useState<string | null>(null)

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    try {
      const body: UpdateShootRequest = {
        name: name.trim(),
        shoot_date: date || null,
        location: location.trim() || null,
        map_link: mapLink.trim() || '',
        status,
        requirements: requirements.map((r) => shootRequirementInput.parse(r)),
      }
      await update.mutateAsync({ id: shoot.id, patch: body })
      setOpen(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not update the shoot.')
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline">
          <Pencil /> Edit
        </Button>
      </DialogTrigger>
      <DialogContent title="Edit shoot" description="Anything set when it was scheduled can be corrected here.">
        <form onSubmit={onSubmit} className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <Label>Shoot name</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} required autoFocus />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <Label>Date</Label>
              <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>Location</Label>
              <Input value={location} onChange={(e) => setLocation(e.target.value)} placeholder="Venue" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <Label>Map link</Label>
              <Input value={mapLink} onChange={(e) => setMapLink(e.target.value)} placeholder="https://maps.google.com/…" type="url" />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>Status</Label>
              <Select value={status} onChange={(e) => setStatus(e.target.value as ShootStatus)}>
                <option value="planned">Planned</option>
                <option value="confirmed">Confirmed</option>
                <option value="completed">Completed</option>
                <option value="cancelled">Cancelled</option>
              </Select>
            </div>
          </div>
          <RequirementsEditor value={requirements} onChange={setRequirements} />
          {error && (
            <p id="form-error" role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          <div className="flex justify-end gap-2">
            <DialogClose asChild>
              <Button type="button" variant="outline">
                Cancel
              </Button>
            </DialogClose>
            <Button type="submit" disabled={update.isPending}>
              {update.isPending ? 'Saving…' : 'Save changes'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
