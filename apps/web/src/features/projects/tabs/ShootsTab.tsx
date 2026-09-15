import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { Camera, ExternalLink, MapPin, Plus, Sparkles } from 'lucide-react'
import { toast } from 'sonner'
import { createShootRequest, shootListItem, type ShootStatus } from '@ipc/contracts'
import { callApi } from '@/shared/api/client'
import { useAuth } from '@/shared/auth/AuthProvider'
import { useAccess } from '@/shared/auth/useAccess'
import { Button } from '@/shared/ui/button'
import { Card, CardContent } from '@/shared/ui/card'
import { Input, Label } from '@/shared/ui/input'
import { Dialog, DialogContent } from '@/shared/ui/dialog'
import { StatusBadge } from '@/shared/ui/status-badge'
import { SkeletonList } from '@/shared/ui/skeleton'
import { ErrorState, EmptyState } from '@/shared/ui/states'
import { humanize } from '@/shared/ui/format'
import { useShootTypes } from '@/features/projects/api'

/**
 * The shoots a wedding studio books over and over. Used as one-click chips so
 * the common case is a single tap — the studio's own saved types take
 * precedence when it has any.
 */
const QUICK_SHOOTS = [
  'Engagement',
  'Haldi',
  'Mehendi',
  'Sangeet',
  'Wedding',
  'Reception',
  'Pre-Wedding',
  'Cocktail',
  'Bride Getting Ready',
  'Groom Getting Ready',
] as const

const todayISO = () => new Date().toISOString().slice(0, 10)

const list = shootListItem.array()

const TONE: Record<ShootStatus, 'info' | 'success' | 'warning' | 'danger'> = {
  planned: 'warning',
  confirmed: 'info',
  completed: 'success',
  cancelled: 'danger',
}

/** This project's own shoots — a real tab instead of a link away to the global page. */
export function ShootsTab({ projectId }: { projectId: string }) {
  const { session } = useAuth()
  const access = useAccess()
  const canEdit = access.hasAction('projects', 'edit')
  const qc = useQueryClient()
  const shootTypes = useShootTypes()
  const [customOpen, setCustomOpen] = useState(false)
  const [pending, setPending] = useState<string | null>(null)

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['shoots', 'project', projectId],
    queryFn: () => callApi(`/shoots?project_id=${projectId}`, { responseSchema: list }),
    enabled: !!session && !!projectId,
    staleTime: 15_000,
  })

  const create = useMutation({
    mutationFn: (input: { name: string; shoot_date?: string; location?: string }) =>
      callApi('/shoots', {
        method: 'POST',
        body: createShootRequest.parse({
          project_id: projectId,
          name: input.name,
          ...(input.shoot_date ? { shoot_date: input.shoot_date } : {}),
          ...(input.location ? { location: input.location } : {}),
          status: 'planned',
        }),
        responseSchema: shootListItem.partial().passthrough(),
      }),
    onSuccess: (_d, v) => {
      toast.success(`${v.name} added`)
      void qc.invalidateQueries({ queryKey: ['shoots'] })
      void qc.invalidateQueries({ queryKey: ['projects'] })
    },
    onError: (e: Error) => toast.error(e.message),
    onSettled: () => setPending(null),
  })

  /**
   * The studio's own saved shoot types come first; the fixed list is the
   * fallback so a brand new studio still gets one-click chips.
   */
  const chips = (() => {
    const own = (shootTypes.data ?? []).filter((t) => !t.is_archived).map((t) => t.name)
    return own.length ? own.slice(0, 10) : [...QUICK_SHOOTS]
  })()

  return (
    <div className="mt-4 flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-muted-foreground">Shoots on this project</h2>
        <Button variant="outline" size="sm" asChild>
          <Link to="/shoots">
            <ExternalLink /> All shoots
          </Link>
        </Button>
      </div>

      {/* Adding a shoot used to mean leaving the project for the global page
          and finding your way back. These create in place, dated today, and
          every field stays editable on the card afterwards. */}
      {canEdit && (
        <div className="rounded-lg border border-border bg-muted/20 p-3">
          <p className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
            <Sparkles className="size-3.5" /> Quick add
          </p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {chips.map((name) => (
              <Button
                key={name}
                size="sm"
                variant="outline"
                disabled={create.isPending}
                onClick={() => {
                  setPending(name)
                  create.mutate({ name, shoot_date: todayISO() })
                }}
              >
                {pending === name ? 'Adding…' : name}
              </Button>
            ))}
            <Button size="sm" onClick={() => setCustomOpen(true)} disabled={create.isPending}>
              <Plus /> Full form
            </Button>
          </div>
          <p className="mt-1.5 text-[11px] text-muted-foreground">
            A chip creates the shoot dated today — open it to set the real date, venue and crew.
          </p>
        </div>
      )}

      {customOpen && (
        <CustomShootDialog
          busy={create.isPending}
          onClose={() => setCustomOpen(false)}
          onCreate={(v) => {
            create.mutate(v, { onSuccess: () => setCustomOpen(false) })
          }}
        />
      )}

      {isLoading ? (
        <SkeletonList rows={3} columns={3} />
      ) : isError ? (
        <ErrorState onRetry={() => void refetch()} />
      ) : !data || data.length === 0 ? (
        <EmptyState
          title="No shoots yet"
          description="Add a shoot to plan crew, requirements, and data for this project."
          action={
            <Button variant="outline" size="sm" asChild>
              <Link to="/shoots">
                <Plus /> Add shoot
              </Link>
            </Button>
          }
        />
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
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
                  <p className="mt-1.5 truncate text-xs text-muted-foreground">
                    Needs: {s.requirements.map((r) => `${r.name} ×${r.quantity}`).join(', ')}
                  </p>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}

/** The full form, for a shoot that is not one of the usual names. */
function CustomShootDialog({
  busy,
  onClose,
  onCreate,
}: {
  busy: boolean
  onClose: () => void
  onCreate: (v: { name: string; shoot_date?: string; location?: string }) => void
}) {
  const [name, setName] = useState('')
  const [date, setDate] = useState(todayISO())
  const [location, setLocation] = useState('')

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent title="Add a shoot" description="Anything the quick chips do not cover.">
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="shoot-name">
              Name <span className="text-destructive">*</span>
            </Label>
            <Input
              id="shoot-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Cocktail night"
            />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="shoot-date">Date</Label>
              <Input id="shoot-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="shoot-loc">Venue</Label>
              <Input
                id="shoot-loc"
                value={location}
                onChange={(e) => setLocation(e.target.value)}
                placeholder="Taj Lands End, Mumbai"
              />
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button
              disabled={!name.trim() || busy}
              onClick={() =>
                onCreate({
                  name: name.trim(),
                  ...(date ? { shoot_date: date } : {}),
                  ...(location.trim() ? { location: location.trim() } : {}),
                })
              }
            >
              {busy ? 'Adding…' : 'Add shoot'}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
