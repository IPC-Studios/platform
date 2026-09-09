import { useState } from 'react'
import { FileSignature, Copy, CheckCircle2, Clock } from 'lucide-react'
import { toast } from 'sonner'
import { AuthedPage } from '@/shared/layout/AuthedPage'
import { PageHeader } from '@/shared/layout/page-header'
import { Button } from '@/shared/ui/button'
import { Label, Select } from '@/shared/ui/input'
import { Dialog, DialogClose, DialogContent, DialogTrigger } from '@/shared/ui/dialog'
import { StatusBadge } from '@/shared/ui/status-badge'
import { ErrorState, EmptyState } from '@/shared/ui/states'
import { SkeletonList } from '@/shared/ui/skeleton'
import { useTermsDocuments, useIssueTerms } from '@/features/terms/api'
import { useProjects } from '@/features/projects/api'

const when = new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })

export function ProjectDocumentsPage() {
  return (
    <AuthedPage module="projects">
      <ProjectDocuments />
    </AuthedPage>
  )
}

function ProjectDocuments() {
  const { data, isLoading, isError, refetch } = useTermsDocuments()

  return (
    <>
      <PageHeader
        title="Project Documents"
        description="Terms & conditions sent to each client, and whether they've agreed."
        actions={<IssueTermsDialog />}
      />

      {isLoading ? (
        <SkeletonList rows={5} columns={4} />
      ) : isError ? (
        <ErrorState onRetry={() => void refetch()} />
      ) : !data || data.length === 0 ? (
        <EmptyState
          title="No documents yet"
          description="Issue terms & conditions for a project to see it here."
          action={<IssueTermsDialog />}
        />
      ) : (
        <div className="overflow-hidden rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-left text-muted-foreground">
              <tr>
                <th className="px-4 py-2 font-medium">Project</th>
                <th className="px-4 py-2 font-medium">Client</th>
                <th className="px-4 py-2 font-medium">Status</th>
                <th className="px-4 py-2 font-medium">Sent</th>
                <th className="px-4 py-2 font-medium" />
              </tr>
            </thead>
            <tbody>
              {data.map((d) => (
                <tr key={d.id} className="border-t border-border hover:bg-muted/30">
                  <td className="px-4 py-2 font-medium">
                    <span className="flex items-center gap-2">
                      <FileSignature className="size-4 text-muted-foreground" />
                      {d.project_name ?? '—'}
                    </span>
                  </td>
                  <td className="px-4 py-2 text-muted-foreground">{d.client_name ?? '—'}</td>
                  <td className="px-4 py-2">
                    {d.acknowledged_at ? (
                      <StatusBadge tone="success">
                        Acknowledged {d.acknowledged_by_name ? `by ${d.acknowledged_by_name}` : ''}
                      </StatusBadge>
                    ) : d.has_active_link ? (
                      <StatusBadge tone="info">Sent, awaiting reply</StatusBadge>
                    ) : (
                      <StatusBadge tone="neutral">Link expired</StatusBadge>
                    )}
                  </td>
                  <td className="px-4 py-2 text-muted-foreground">{when.format(new Date(d.created_at))}</td>
                  <td className="px-4 py-2 text-right">
                    <IssueTermsDialog
                      projectId={d.project_id}
                      trigger={
                        <Button variant="outline" size="sm">
                          Resend
                        </Button>
                      }
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  )
}

function IssueTermsDialog({ projectId, trigger }: { projectId?: string | null; trigger?: React.ReactNode }) {
  const { data: projects } = useProjects()
  const issue = useIssueTerms()
  const [open, setOpen] = useState(false)
  const [selectedProject, setSelectedProject] = useState(projectId ?? '')
  const [body, setBody] = useState('')
  const [link, setLink] = useState<string | null>(null)

  async function onSubmit() {
    if (!body.trim()) return
    const res = await issue.mutateAsync({ project_id: selectedProject || null, rendered_body: body.trim() })
    setLink(`${window.location.origin}/terms/acknowledge?token=${res.token}`)
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o)
        if (!o) {
          setLink(null)
          setBody('')
        }
      }}
    >
      <DialogTrigger asChild>
        {trigger ?? (
          <Button>
            <FileSignature /> Issue terms
          </Button>
        )}
      </DialogTrigger>
      <DialogContent
        title="Issue terms & conditions"
        description="Generates a link the client opens to read and agree."
      >
        {link ? (
          <div className="flex flex-col gap-3">
            <div className="flex items-center gap-2 rounded-lg border border-border bg-muted/30 p-3">
              <CheckCircle2 className="size-4 shrink-0 text-success" />
              <p className="min-w-0 flex-1 truncate text-sm">{link}</p>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => {
                  void navigator.clipboard.writeText(link)
                  toast.success('Link copied')
                }}
              >
                <Copy className="size-4" />
              </Button>
            </div>
            <div className="flex justify-end">
              <DialogClose asChild>
                <Button>Done</Button>
              </DialogClose>
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            <div className="flex flex-col gap-1.5">
              <Label>Project (optional)</Label>
              <Select value={selectedProject} onChange={(e) => setSelectedProject(e.target.value)}>
                <option value="">Not linked to a project</option>
                {(projects ?? []).map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </Select>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>Terms & conditions text</Label>
              <textarea
                value={body}
                onChange={(e) => setBody(e.target.value)}
                rows={8}
                placeholder="Paste or write the terms the client needs to agree to…"
                className="w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm"
              />
            </div>
            <div className="flex justify-end gap-2">
              <DialogClose asChild>
                <Button variant="outline">Cancel</Button>
              </DialogClose>
              <Button onClick={() => void onSubmit()} disabled={!body.trim() || issue.isPending}>
                {issue.isPending ? (
                  <>
                    <Clock className="size-4 animate-pulse" /> Issuing…
                  </>
                ) : (
                  'Generate link'
                )}
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
