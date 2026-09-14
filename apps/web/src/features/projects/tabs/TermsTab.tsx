import { FileSignature, Copy } from 'lucide-react'
import { Button } from '@/shared/ui/button'
import { Card, CardContent } from '@/shared/ui/card'
import { StatusBadge } from '@/shared/ui/status-badge'
import { SkeletonList } from '@/shared/ui/skeleton'
import { ErrorState, EmptyState } from '@/shared/ui/states'
import { useTermsDocuments } from '@/features/terms/api'
import { IssueTermsDialog } from '@/routes/project-documents'

const when = new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })

/** This project's own terms & conditions history — issue, resend, and see acknowledgement status. */
export function TermsTab({ projectId, canEdit }: { projectId: string; canEdit: boolean }) {
  const { data, isLoading, isError, refetch } = useTermsDocuments()
  const docs = (data ?? []).filter((d) => d.project_id === projectId)

  return (
    <div className="mt-4 flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-muted-foreground">Terms &amp; conditions</h2>
        {canEdit && <IssueTermsDialog projectId={projectId} />}
      </div>

      {isLoading ? (
        <SkeletonList rows={2} columns={3} />
      ) : isError ? (
        <ErrorState onRetry={() => void refetch()} />
      ) : docs.length === 0 ? (
        <EmptyState
          title="No terms issued yet"
          description="Send this project's terms & conditions for the client to read and agree to."
          action={canEdit ? <IssueTermsDialog projectId={projectId} /> : undefined}
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
                    <IssueTermsDialog
                      projectId={projectId}
                      trigger={
                        <Button variant="outline" size="sm">
                          <Copy /> Resend
                        </Button>
                      }
                    />
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
