import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Eye, ClipboardList, Camera, FileCheck } from 'lucide-react'
import { taskListItem, shootListItem, z } from '@ipc/contracts'
import { AuthedPage } from '@/shared/layout/AuthedPage'
import { PageHeader } from '@/shared/layout/page-header'
import { Select } from '@/shared/ui/input'
import { StatusBadge } from '@/shared/ui/status-badge'
import { EmptyState } from '@/shared/ui/states'
import { SkeletonList } from '@/shared/ui/skeleton'
import { Card, CardContent } from '@/shared/ui/card'
import { callApi } from '@/shared/api/client'
import { useAuth } from '@/shared/auth/AuthProvider'
import { useDirectory } from '@/features/team/api'

const tasksList = taskListItem.array()
const shootsList = shootListItem.array()
const workSubmission = z.object({
  id: z.string().uuid(),
  project_id: z.string().uuid().nullable(),
  task_id: z.string().uuid().nullable(),
  submission_link: z.string().nullable(),
  notes: z.string().nullable(),
  status: z.enum(['submitted', 'approved', 'rejected']),
  review_notes: z.string().nullable(),
  created_at: z.string(),
})
const submissionsList = workSubmission.array()

export function TeamWorkPreviewPage() {
  return (
    <AuthedPage module="team_work_preview">
      <TeamWorkPreview />
    </AuthedPage>
  )
}

function TeamWorkPreview() {
  const { data: directory } = useDirectory()
  const { session } = useAuth()
  const [userId, setUserId] = useState('')
  const members = (directory ?? []).filter((m) => m.status === 'active')
  const selected = members.find((m) => m.user_id === userId)

  const tasks = useQuery({
    queryKey: ['team-work-preview', 'tasks', userId],
    queryFn: () => callApi(`/tasks?assignee=${userId}`, { responseSchema: tasksList }),
    enabled: !!session && !!userId,
  })
  const shoots = useQuery({
    queryKey: ['team-work-preview', 'shoots', userId],
    queryFn: () => callApi(`/shoots?assignee=${userId}`, { responseSchema: shootsList }),
    enabled: !!session && !!userId,
  })
  const submissions = useQuery({
    queryKey: ['team-work-preview', 'submissions', userId],
    queryFn: () => callApi(`/work/submissions?user_id=${userId}`, { responseSchema: submissionsList }),
    enabled: !!session && !!userId,
  })

  return (
    <>
      <PageHeader
        title="Team Work Preview"
        description="See what a team member's own work view shows them — read-only, and they're never notified."
      />

      <Card>
        <CardContent className="flex flex-wrap items-center gap-3 p-4">
          <Eye className="size-4 text-muted-foreground" />
          <span className="text-sm font-medium">Team member</span>
          <Select value={userId} onChange={(e) => setUserId(e.target.value)} className="w-64">
            <option value="">Select someone…</option>
            {members.map((m) => (
              <option key={m.user_id} value={m.user_id}>
                {m.name}
              </option>
            ))}
          </Select>
        </CardContent>
      </Card>

      {!userId ? (
        <div className="mt-4">
          <EmptyState title="Nobody selected" description="Pick a team member above to see their tasks, shoots and submissions." />
        </div>
      ) : (
        <div className="mt-4 grid gap-4 lg:grid-cols-3">
          <Section title="Tasks" icon={ClipboardList} loading={tasks.isLoading}>
            {(tasks.data ?? []).length === 0 ? (
              <EmptyState title="No tasks assigned" />
            ) : (
              <ul className="flex flex-col gap-2">
                {(tasks.data ?? []).map((t) => (
                  <li key={t.id} className="rounded-lg border border-border p-3 text-sm">
                    <p className="font-medium">{t.title}</p>
                    <div className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
                      <StatusBadge tone={t.status === 'completed' ? 'success' : 'neutral'}>{t.status}</StatusBadge>
                      {t.project_name && <span>{t.project_name}</span>}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Section>

          <Section title="Shoots" icon={Camera} loading={shoots.isLoading}>
            {(shoots.data ?? []).length === 0 ? (
              <EmptyState title="No upcoming shoots" />
            ) : (
              <ul className="flex flex-col gap-2">
                {(shoots.data ?? []).map((s) => (
                  <li key={s.id} className="rounded-lg border border-border p-3 text-sm">
                    <p className="font-medium">{s.name}</p>
                    <div className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
                      <span>{s.shoot_date ?? 'No date'}</span>
                      {s.project_name && <span>· {s.project_name}</span>}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Section>

          <Section title="Work submissions" icon={FileCheck} loading={submissions.isLoading}>
            {(submissions.data ?? []).length === 0 ? (
              <EmptyState title="Nothing submitted yet" />
            ) : (
              <ul className="flex flex-col gap-2">
                {(submissions.data ?? []).map((s) => (
                  <li key={s.id} className="rounded-lg border border-border p-3 text-sm">
                    <p className="truncate font-medium">{s.notes || s.submission_link || 'Submission'}</p>
                    <StatusBadge
                      className="mt-1"
                      tone={s.status === 'approved' ? 'success' : s.status === 'rejected' ? 'danger' : 'info'}
                    >
                      {s.status}
                    </StatusBadge>
                  </li>
                ))}
              </ul>
            )}
          </Section>
        </div>
      )}

      {selected && (
        <p className="mt-4 text-xs text-muted-foreground">
          Previewing {selected.name}'s view. They cannot see that you did this.
        </p>
      )}
    </>
  )
}

function Section({
  title,
  icon: Icon,
  loading,
  children,
}: {
  title: string
  icon: React.ComponentType<{ className?: string }>
  loading: boolean
  children: React.ReactNode
}) {
  return (
    <Card>
      <CardContent className="p-4">
        <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold">
          <Icon className="size-4 text-muted-foreground" /> {title}
        </h3>
        {loading ? <SkeletonList rows={3} columns={1} /> : children}
      </CardContent>
    </Card>
  )
}
