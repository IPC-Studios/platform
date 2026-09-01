import { useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Plus, ExternalLink } from 'lucide-react'
import { workSubmission, type SubmitWorkRequest, z } from '@ipc/contracts'
import { callApi } from '@/shared/api/client'
import { useAuth } from '@/shared/auth/AuthProvider'
import { AuthedPage } from '@/shared/layout/AuthedPage'
import { PageHeader } from '@/shared/layout/page-header'
import { Button } from '@/shared/ui/button'
import { SkeletonCards } from '@/shared/ui/skeleton'
import { Card, CardContent } from '@/shared/ui/card'
import { Dialog, DialogClose, DialogContent, DialogTrigger } from '@/shared/ui/dialog'
import { Input, Label } from '@/shared/ui/input'
import { StatusBadge } from '@/shared/ui/status-badge'
import { ErrorState, EmptyState } from '@/shared/ui/states'

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
    onSuccess: () => qc.invalidateQueries({ queryKey: ['work', 'submissions'] }),
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
                <StatusBadge tone={TONE[s.status]}>{s.status}</StatusBadge>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </>
  )
}

function SubmitDialog() {
  const submit = useSubmitWork()
  const [open, setOpen] = useState(false)
  const [link, setLink] = useState('')
  const [notes, setNotes] = useState('')
  const [error, setError] = useState<string | null>(null)

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    try {
      await submit.mutateAsync({
        task_id: null,
        project_id: null,
        submission_link: link.trim(),
        ...(notes.trim() ? { notes: notes.trim() } : {}),
      })
      setOpen(false)
      setLink('')
      setNotes('')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not submit.')
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <Plus /> Submit work
        </Button>
      </DialogTrigger>
      <DialogContent title="Submit work" description="Share a link or drive location for review.">
        <form onSubmit={onSubmit} className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <Label>Link / location</Label>
            <Input value={link} onChange={(e) => setLink(e.target.value)} placeholder="https://drive.google.com/…" required autoFocus />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>Notes</Label>
            <Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="What is this?" />
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <div className="mt-2 flex justify-end gap-2">
            <DialogClose asChild>
              <Button type="button" variant="outline">
                Cancel
              </Button>
            </DialogClose>
            <Button type="submit" disabled={submit.isPending}>
              {submit.isPending ? 'Submitting…' : 'Submit'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
