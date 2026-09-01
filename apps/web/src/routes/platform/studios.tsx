import { Building2, Users, FolderKanban } from 'lucide-react'
import type { PlanGate, PlatformStudio } from '@ipc/contracts'
import { PlatformPage } from '@/shared/layout/PlatformPage'
import { PageHeader } from '@/shared/layout/page-header'
import { StatusBadge } from '@/shared/ui/status-badge'
import { SkeletonList } from '@/shared/ui/skeleton'
import { ErrorState, EmptyState } from '@/shared/ui/states'
import { Button } from '@/shared/ui/button'
import { useConfirm } from '@/shared/ui/confirm'
import { humanize } from '@/shared/ui/format'
import { usePlatformStudios, usePlatformPlanAction } from '@/features/platform/api'

const GATE_TONE: Record<PlanGate, 'success' | 'info' | 'warning' | 'danger'> = {
  active: 'success',
  grandfathered: 'info',
  grace: 'warning',
  expired: 'danger',
}

const fmtDate = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '—'

export function PlatformStudiosPage() {
  return (
    <PlatformPage>
      <Studios />
    </PlatformPage>
  )
}

function Studios() {
  const { data, isLoading, isError, refetch } = usePlatformStudios()
  const planAction = usePlatformPlanAction()
  const confirm = useConfirm()

  const onExpire = async (s: PlatformStudio) => {
    const okToExpire = await confirm({
      title: `Expire ${s.name}?`,
      description: 'The studio loses access immediately until a new plan or trial is granted.',
      confirmLabel: 'Expire now',
      destructive: true,
    })
    if (okToExpire) planAction.mutate({ studioId: s.id, action: 'expire' })
  }

  if (isLoading) return <SkeletonList rows={5} columns={6} />
  if (isError) return <ErrorState onRetry={() => void refetch()} />
  if (!data || data.length === 0)
    return (
      <>
        <PageHeader title="Studios" description="Every tenant on the platform." />
        <EmptyState title="No studios yet" description="Studios appear here as they register." />
      </>
    )

  return (
    <>
      <PageHeader title="Studios" description="Every tenant on the platform." />
      <div className="overflow-hidden rounded-lg border border-border">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-left text-muted-foreground">
            <tr>
              <th className="px-4 py-2 font-medium">Studio</th>
              <th className="px-4 py-2 font-medium">Owner</th>
              <th className="px-4 py-2 font-medium">Plan</th>
              <th className="px-4 py-2 text-right font-medium">
                <Users className="inline h-4 w-4" aria-label="Users" />
              </th>
              <th className="px-4 py-2 text-right font-medium">
                <FolderKanban className="inline h-4 w-4" aria-label="Projects" />
              </th>
              <th className="px-4 py-2 font-medium">Expiry</th>
              <th className="px-4 py-2 font-medium">Joined</th>
              <th className="px-4 py-2 text-right font-medium">Actions</th>
            </tr>
          </thead>
          <tbody>
            {data.map((s) => (
              <tr key={s.id} className="border-t border-border">
                <td className="px-4 py-2 font-medium">
                  <Building2 className="mr-1.5 inline h-4 w-4 text-muted-foreground" />
                  {s.name}
                </td>
                <td className="px-4 py-2 text-muted-foreground">{s.owner_email ?? '—'}</td>
                <td className="px-4 py-2">
                  <StatusBadge tone={GATE_TONE[s.plan_gate]}>{humanize(s.plan_gate)}</StatusBadge>
                </td>
                <td className="px-4 py-2 text-right">{s.user_count}</td>
                <td className="px-4 py-2 text-right">{s.project_count}</td>
                <td className="px-4 py-2 text-muted-foreground">{fmtDate(s.plan_expiry)}</td>
                <td className="px-4 py-2 text-muted-foreground">{fmtDate(s.created_at)}</td>
                <td className="px-4 py-2">
                  <div className="flex justify-end gap-1.5">
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={planAction.isPending}
                      onClick={() => planAction.mutate({ studioId: s.id, action: 'extend', months: 12 })}
                    >
                      Extend 1y
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={planAction.isPending}
                      onClick={() => planAction.mutate({ studioId: s.id, action: 'trial' })}
                    >
                      Trial
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="text-destructive"
                      disabled={planAction.isPending}
                      onClick={() => void onExpire(s)}
                    >
                      Expire
                    </Button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  )
}
