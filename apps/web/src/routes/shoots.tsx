import { useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Camera, Plus, MapPin } from 'lucide-react'
import { shootListItem, z, type CreateShootRequest, type ShootStatus } from '@ipc/contracts'
import { callApi } from '@/shared/api/client'
import { useAuth } from '@/shared/auth/AuthProvider'
import { useAccess } from '@/shared/auth/useAccess'
import { AuthedPage } from '@/shared/layout/AuthedPage'
import { PageHeader } from '@/shared/layout/page-header'
import { Button } from '@/shared/ui/button'
import { Card, CardContent } from '@/shared/ui/card'
import { Dialog, DialogClose, DialogContent, DialogTrigger } from '@/shared/ui/dialog'
import { Input, Label, Select } from '@/shared/ui/input'
import { StatusBadge } from '@/shared/ui/status-badge'
import { LoadingState, ErrorState, EmptyState } from '@/shared/ui/states'
import { humanize } from '@/shared/ui/format'
import { useProjects } from '@/features/projects/api'

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
        <LoadingState />
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
                <div className="mt-2 flex items-center gap-3 text-xs text-muted-foreground">
                  {s.shoot_date && <span>{s.shoot_date}</span>}
                  {s.location && (
                    <span className="flex items-center gap-1">
                      <MapPin className="size-3" />
                      {s.location}
                    </span>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </>
  )
}

function ShootDialog() {
  const qc = useQueryClient()
  const { data: projects } = useProjects()
  const create = useMutation({
    mutationFn: (input: CreateShootRequest) =>
      callApi('/shoots', { method: 'POST', body: input, responseSchema: z.object({ id: z.string() }) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['shoots'] }),
  })
  const [open, setOpen] = useState(false)
  const [projectId, setProjectId] = useState('')
  const [name, setName] = useState('')
  const [date, setDate] = useState('')
  const [location, setLocation] = useState('')
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
      }
      await create.mutateAsync(body)
      setOpen(false)
      setName('')
      setDate('')
      setLocation('')
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
          {error && <p className="text-sm text-destructive">{error}</p>}
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
