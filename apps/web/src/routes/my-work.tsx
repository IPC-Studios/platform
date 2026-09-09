import { useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Plus, ExternalLink, Pencil } from 'lucide-react'
import { workSubmission, type SubmitWorkRequest, type UpdateWorkSubmissionRequest, type WorkSubmission, z } from '@ipc/contracts'
import { toast } from 'sonner'
import { callApi } from '@/shared/api/client'
import { useAuth } from '@/shared/auth/AuthProvider'
import { AuthedPage } from '@/shared/layout/AuthedPage'
import { PageHeader } from '@/shared/layout/page-header'
import { Button } from '@/shared/ui/button'
import { SkeletonCards } from '@/shared/ui/skeleton'
import { Card, CardContent } from '@/shared/ui/card'
import { Dialog, DialogClose, DialogContent, DialogTrigger } from '@/shared/ui/dialog'
import { Input, Label, Select } from '@/shared/ui/input'
import { StatusBadge } from '@/shared/ui/status-badge'
import { ErrorState, EmptyState } from '@/shared/ui/states'
import { useMyTasks } from '@/features/tasks/api'

const list = workSubmission.array()
const TONE = { submitted: 'warning', approved: 'success', rejected: 'danger' } as const

function useMySubmissions() {
  const { session } = useAuth()
  return useQuery({
    queryKey: ['work', 'submissions'],
    queryFn: () => callApi('/work/submissions', { responseSchema: list }),
    enabled: !!session,
    staleTime: 15_000,
  })
}

function useSubmitWork() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: SubmitWorkRequest) =>
      callApi('/work/submissions', {
        method: 'POST',
        body: input,
        responseSchema: z.object({ id: z.string() }),
      }),
    onSuccess: () => {
      toast.success('Work submitted')
      void qc.invalidateQueries({ queryKey: ['work', 'submissions'] })
    },
  })
}

function useUpdateWorkSubmission() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: UpdateWorkSubmissionRequest }) =>
      callApi(`/work/submissions/${id}`, {
        method: 'PATCH',
        body: patch,
        responseSchema: z.unknown(),
      }),
    onSuccess: () => {
      toast.success('Submission updated')
      void qc.invalidateQueries({ queryKey: ['work', 'submissions'] })
    },
  })
}

export function MyWorkPage() {
  return (
    <AuthedPage module="projects">
      <MyWork />
    </AuthedPage>
  )
}

function MyWork() {
  const { data, isLoading, isError, refetch } = useMySubmissions()
  return (
    <>
      <PageHeader
        title="My work"
        description="Submit finished work and track its review."
        actions={<SubmitDialog />}
      />
      {isLoading ? (
        <SkeletonCards count={3} />
      ) : isError ? (
        <ErrorState onRetry={() => void refetch()} />
      ) : !data || data.length === 0 ? (
        <EmptyState title="Nothing submitted yet" description="Submit a link when your work is ready." action={<SubmitDialog />} />
      ) : (
        <div className="flex flex-col gap-3">
          {data.map((s) => (
            <Card key={s.id}>
              <CardContent className="flex items-start justify-between gap-4 p-4">
                <div className="min-w-0">
                  <a
                    href={s.submission_link ?? '#'}
                    target="_blank"
                    rel="noreferrer"
                    className="flex items-center gap-1 font-medium text-primary hover:underline"
                  >
                    {s.notes ?? s.submission_link} <ExternalLink className="size-3.5" />
                  </a>
                  {s.review_notes && (
                    <p className="mt-1 text-sm text-muted-foreground">Review: {s.review_notes}</p>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  {s.status === 'submitted' && (
                    <SubmitDialog
                      submission={s}
                      trigger={
                        <Button size="sm" variant="ghost">
                          <Pencil />
                        </Button>
                      }
                    />
                  )}
                  <StatusBadge tone={TONE[s.status]}>{s.status}</StatusBadge>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </>
  )
}

function SubmitDialog({ submission, trigger }: { submission?: WorkSubmission; trigger?: React.ReactNode } = {}) {
  const isEdit = !!submission
  const submit = useSubmitWork()
  const update = useUpdateWorkSubmission()
  const { data: myTasks } = useMyTasks()
  const [open, setOpen] = useState(false)
  const [taskId, setTaskId] = useState('')
  const [link, setLink] = useState(submission?.submission_link ?? '')
  const [locationNote, setLocationNote] = useState(submission?.location_note ?? '')
  const [notes, setNotes] = useState(submission?.notes ?? '')
  const [error, setError] = useState<string | null>(null)

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    try {
      if (isEdit) {
        await update.mutateAsync({
          id: submission.id,
          patch: {
            submission_link: link.trim(),
            ...(locationNote.trim() ? { location_note: locationNote.trim() } : {}),
            ...(notes.trim() ? { notes: notes.trim() } : {}),
          },
        })
      } else {
        const task = (myTasks ?? []).find((t) => t.id === taskId)
        await submit.mutateAsync({
          task_id: taskId || null,
          project_id: task?.project_id ?? null,
          submission_link: link.trim(),
          ...(locationNote.trim() ? { location_note: locationNote.trim() } : {}),
          ...(notes.trim() ? { notes: notes.trim() } : {}),
        })
      }
      setOpen(false)
      if (!isEdit) {
        setTaskId('')
        setLink('')
        setLocationNote('')
        setNotes('')
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : `Could not ${isEdit ? 'update' : 'submit'}.`)
    }
  }

  const busy = submit.isPending || update.isPending

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {trigger ?? (
          <Button>
            <Plus /> Submit work
          </Button>
        )}
      </DialogTrigger>
      <DialogContent title={isEdit ? 'Edit submission' : 'Submit work'} description="Share a link or drive location for review.">
        <form onSubmit={onSubmit} className="flex flex-col gap-3">
          {!isEdit && (
            <div className="flex flex-col gap-1.5">
              <Label>Task</Label>
              <Select value={taskId} onChange={(e) => setTaskId(e.target.value)}>
                <option value="">Not linked to a task</option>
                {(myTasks ?? []).map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.title}
                  </option>
                ))}
              </Select>
            </div>
          )}
          <div className="flex flex-col gap-1.5">
            <Label>Link</Label>
            <Input value={link} onChange={(e) => setLink(e.target.value)} placeholder="https://drive.google.com/…" required autoFocus />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>Drive / folder (optional)</Label>
            <Input value={locationNote} onChange={(e) => setLocationNote(e.target.value)} placeholder="e.g. Backup HDD 3, /Weddings/Sharma" />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>Notes</Label>
            <Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="What is this?" />
          </div>
          {error && (
            <p id="form-error" role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          <div className="mt-2 flex justify-end gap-2">
            <DialogClose asChild>
              <Button type="button" variant="outline">
                Cancel
              </Button>
            </DialogClose>
            <Button type="submit" disabled={busy}>
              {busy ? 'Saving…' : isEdit ? 'Save changes' : 'Submit'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
