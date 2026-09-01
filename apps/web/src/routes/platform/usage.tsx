import { Building2, CheckCircle2, Users, IndianRupee } from 'lucide-react'
import { PlatformPage } from '@/shared/layout/PlatformPage'
import { PageHeader } from '@/shared/layout/page-header'
import { StatCard } from '@/shared/ui/stat-card'
import { SkeletonTiles } from '@/shared/ui/skeleton'
import { ErrorState } from '@/shared/ui/states'
import { formatINR } from '@/shared/ui/format'
import { usePlatformUsage } from '@/features/platform/api'

export function PlatformUsagePage() {
  return (
    <PlatformPage>
      <Usage />
    </PlatformPage>
  )
}

function Usage() {
  const { data, isLoading, isError, refetch } = usePlatformUsage()

  if (isLoading) return <SkeletonTiles count={4} />
  if (isError || !data) return <ErrorState onRetry={() => void refetch()} />

  return (
    <>
      <PageHeader title="Usage" description="Platform-wide totals across every tenant." />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Studios" value={String(data.studio_count)} icon={Building2} />
        <StatCard label="Active studios" value={String(data.active_studio_count)} icon={CheckCircle2} />
        <StatCard label="Total users" value={String(data.total_users)} icon={Users} />
        <StatCard label="Revenue (30d)" value={formatINR(data.revenue_last_30d)} icon={IndianRupee} />
      </div>
    </>
  )
}
