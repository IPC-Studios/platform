import { useState } from 'react'
import { FileSignature, Copy, Plus } from 'lucide-react'
import { Button } from '@/shared/ui/button'
import { Card, CardContent } from '@/shared/ui/card'
import { StatusBadge } from '@/shared/ui/status-badge'
import { SkeletonList } from '@/shared/ui/skeleton'
import { ErrorState, EmptyState } from '@/shared/ui/states'
import { useTermsDocuments } from '@/features/terms/api'
import { TermsWizard } from '@/features/terms/TermsWizard'

const when = new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })

/** This project's own terms & conditions history — issue, resend, and see acknowledgement status. */
export function TermsTab({ projectId, canEdit }: { projectId: string; canEdit: boolean }) {
  const { data, isLoading, isError, refetch } = useTermsDocuments()
  const docs = (data ?? []).filter((d) => d.project_id === projectId)
  const [authoring, setAuthoring] = useState(false)

  if (authoring && canEdit) {
    return (
      <TermsWizard
        projectId={projectId}
        onIssued={() => setAuthoring(false)}
        onCancel={() => setAuthoring(false)}
      />
    )
  }

  return (
    <div className="mt-4 flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-muted-foreground">Terms &amp; conditions</h2>
        {canEdit && (
          <Button size="sm" onClick={() => setAuthoring(true)}>
            <Plus /> New terms document
          </Button>
        )}
      </div>

      {isLoading ? (
        <SkeletonList rows={2} columns={3} />
      ) : isError ? (
        <ErrorState onRetry={() => void refetch()} />
      ) : docs.length === 0 ? (
        <EmptyState
          title="No terms issued yet"
          description="Send this project's terms & conditions for the client to read and agree to."
          action={
            canEdit ? (
              <Button onClick={() => setAuthoring(true)}>
                <Plus /> New terms document
              </Button>
            ) : undefined
          }
        />
      ) : (
        <ul className="flex flex-col gap-2">
          {docs.map((d) => (
            <li key={d.id}>
              <Card>
                <CardContent className="flex flex-wrap items-center gap-3 p-4">
                  <FileSignature className="size-4 shrink-0 text-muted-foreground" />
                  <span className="min-w-0 flex-1 text-sm text-muted-foreground">
                    Sent {when.format(new Date(d.created_at))}
                  </span>
                  {d.acknowledged_at ? (
                    <StatusBadge tone="success">
                      Acknowledged {d.acknowledged_by_name ? `by ${d.acknowledged_by_name}` : ''}
                    </StatusBadge>
                  ) : d.has_active_link ? (
                    <StatusBadge tone="info">Sent, awaiting reply</StatusBadge>
                  ) : (
                    <StatusBadge tone="neutral">Link expired</StatusBadge>
                  )}
                  {canEdit && (
                    <Button variant="outline" size="sm" onClick={() => setAuthoring(true)}>
                      <Copy /> Reissue
                    </Button>
                  )}
                </CardContent>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
