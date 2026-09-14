import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { Camera, ExternalLink, MapPin, Plus } from 'lucide-react'
import { shootListItem, type ShootStatus } from '@ipc/contracts'
import { callApi } from '@/shared/api/client'
import { useAuth } from '@/shared/auth/AuthProvider'
import { Button } from '@/shared/ui/button'
import { Card, CardContent } from '@/shared/ui/card'
import { StatusBadge } from '@/shared/ui/status-badge'
import { SkeletonList } from '@/shared/ui/skeleton'
import { ErrorState, EmptyState } from '@/shared/ui/states'
import { humanize } from '@/shared/ui/format'

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
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['shoots', 'project', projectId],
    queryFn: () => callApi(`/shoots?project_id=${projectId}`, { responseSchema: list }),
    enabled: !!session && !!projectId,
    staleTime: 15_000,
  })

  return (
    <div className="mt-4 flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-muted-foreground">Shoots on this project</h2>
        <Button variant="outline" size="sm" asChild>
          <Link to="/shoots">
            <Plus /> Add shoot
          </Link>
        </Button>
      </div>

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
