import { useState } from 'react'
import { useNavigate, useParams } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { ArrowLeft, CalendarDays, Clock } from 'lucide-react'
import { attendanceRecord } from '@ipc/contracts'
import { callApi } from '@/shared/api/client'
import { useAuth } from '@/shared/auth/AuthProvider'
import { AuthedPage } from '@/shared/layout/AuthedPage'
import { Button } from '@/shared/ui/button'
import { Card, CardContent } from '@/shared/ui/card'
import { Label, Select } from '@/shared/ui/input'
import { SkeletonList } from '@/shared/ui/skeleton'
import { StatusBadge } from '@/shared/ui/status-badge'
import { EmptyState, ErrorState } from '@/shared/ui/states'
import { useDirectory } from '@/features/team/api'
import { STATUS_LABEL, STATUS_TONE, formatTime } from '@/features/hr/attendance'

const myList = attendanceRecord.array()

/**
 * One member's attendance history (Lovable parity with
 * _app.attendance.$firebase_uid). Month/year scoped; self, owner, admin or
 * manager only (enforced again on the server).
 */
export function AttendanceMemberPage() {
  return (
    <AuthedPage module="attendance">
      <MemberHistory />
    </AuthedPage>
  )
}

function MemberHistory() {
  const { uid } = useParams({ from: '/authed/attendance/$uid' })
  const { session } = useAuth()
  const navigate = useNavigate()
  const now = new Date()
  const [month, setMonth] = useState(now.getMonth() + 1)
  const [year, setYear] = useState(now.getFullYear())

  const { data: directory } = useDirectory()
  const member = (directory ?? []).find((m) => m.user_id === uid)

  const history = useQuery({
    queryKey: ['hr', 'attendance', 'user', uid, month, year],
    queryFn: () =>
      callApi(`/hr/attendance/user/${uid}?month=${month}&year=${year}`, {
        responseSchema: myList,
      }),
    enabled: !!session && !!uid,
    staleTime: 15_000,
  })

  const years = Array.from({ length: 3 }, (_, i) => now.getFullYear() - i)

  return (
    <section className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="ghost" size="sm" onClick={() => navigate({ to: '/attendance' })}>
          <ArrowLeft className="mr-1 size-4" /> Attendance
        </Button>
        <h2 className="text-lg font-semibold">{member?.name ?? 'Team member'}</h2>
      </div>

      <div className="grid max-w-xl gap-3 rounded-lg border border-border bg-card p-4 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <Label>Month</Label>
          <Select value={String(month)} onChange={(e) => setMonth(Number(e.target.value))}>
            {Array.from({ length: 12 }, (_, i) => (
              <option key={i + 1} value={String(i + 1)}>
                {new Date(2000, i, 1).toLocaleString('en-IN', { month: 'long' })}
              </option>
            ))}
          </Select>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label>Year</Label>
          <Select value={String(year)} onChange={(e) => setYear(Number(e.target.value))}>
            {years.map((y) => (
              <option key={y} value={String(y)}>{y}</option>
            ))}
          </Select>
        </div>
      </div>

      {history.isLoading ? (
        <SkeletonList rows={5} columns={4} />
      ) : history.isError ? (
        <ErrorState onRetry={() => void history.refetch()} />
      ) : !history.data || history.data.length === 0 ? (
        <Card>
          <CardContent className="py-4">
            <EmptyState title="No records this month" description="Pick another month." />
          </CardContent>
        </Card>
      ) : (
        <div className="flex flex-col gap-2">
          {history.data.map((a) => (
            <Card key={a.id}>
              <CardContent className="flex flex-wrap items-center gap-3 p-3">
                <CalendarDays className="size-4 shrink-0 text-muted-foreground" />
                <span className="text-sm font-medium">{a.a_date}</span>
                <span className="flex items-center gap-1 text-sm text-muted-foreground">
                  <Clock className="size-3.5" />
                  in {formatTime(a.check_in_at)} · out {formatTime(a.check_out_at)}
                </span>
                <StatusBadge
                  className="ml-auto"
                  tone={STATUS_TONE[a.check_in_at && !a.check_out_at ? 'not_checked_out' : a.status]}
                >
                  {STATUS_LABEL[a.check_in_at && !a.check_out_at ? 'not_checked_out' : a.status]}
                </StatusBadge>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </section>
  )
}

// Re-exported for the router without pulling AuthedPage twice.
export function AttendanceUidPage() {
  return <AttendanceMemberPage />
}
