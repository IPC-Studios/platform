import { Construction } from 'lucide-react'
import type { ModuleKey } from '@ipc/permissions'
import { AuthedPage } from '@/shared/layout/AuthedPage'
import { PageHeader } from '@/shared/layout/page-header'

/** Placeholder for nav destinations whose feature phase isn't built yet. */
export function comingSoon(title: string, module: ModuleKey, phase: string) {
  return function ComingSoonPage() {
    return (
      <AuthedPage module={module}>
        <PageHeader title={title} />
        <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed border-border py-20 text-center">
          <Construction className="size-8 text-muted-foreground" />
          <p className="font-medium">Coming in {phase}</p>
          <p className="max-w-sm text-sm text-muted-foreground">
            This area is on the roadmap. The navigation and access rules are already wired.
          </p>
        </div>
      </AuthedPage>
    )
  }
}
