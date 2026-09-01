import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import {
  CalendarDays,
  Clock,
  Download,
  LogIn,
  LogOut,
  MapPin,
  RefreshCw,
} from 'lucide-react'
import {
  attendanceDayRow,
  attendanceRecord,
  companyFence,
  setFenceRequest,
  z,
  type AttendanceDayRow,
  type CheckInRequest,
  type SetFenceRequest,
} from '@ipc/contracts'
import { withinFence } from '@ipc/domain'
import { callApi } from '@/shared/api/client'
import { useAuth } from '@/shared/auth/AuthProvider'
import { AuthedPage } from '@/shared/layout/AuthedPage'
import { PageHeader } from '@/shared/layout/page-header'
import { SectionTabs } from '@/shared/layout/section-tabs'
import { Button } from '@/shared/ui/button'
import { SkeletonList } from '@/shared/ui/skeleton'
import { Card, CardContent } from '@/shared/ui/card'
import { cn } from '@/shared/ui/cn'
import { Dialog, DialogClose, DialogContent, DialogTrigger } from '@/shared/ui/dialog'
import { HowToUse } from '@/shared/ui/how-to-use'
import { Input, Label, Select } from '@/shared/ui/input'
import { StatusBadge } from '@/shared/ui/status-badge'
import { EmptyState, ErrorState } from '@/shared/ui/states'
import { useIsMobile } from '@/shared/hooks/use-mobile'
import { Avatar } from '@/shared/ui/avatar'
import { SkeletonTable } from '@/shared/ui/skeleton'
import { CountUp } from '@/shared/ui/count-up'
import {
  EMPTY_FILTERS,
  STATUS_LABEL,
  STATUS_TONE,
  displayStatus,
  filterRows,
  formatTime,
  hasFilters,
  hoursWorked,
  summarise,
  toCsv,
  todayISO,
  type AttendanceFilters,
  type DisplayStatus,
} from '@/features/hr/attendance'

const myList = attendanceRecord.array()
const dayList = attendanceDayRow.array()
const idOnly = z.object({ id: z.string() })

type Tab = 'dashboard' | 'mine'

export function AttendancePage() {
  return (
    <AuthedPage module="attendance">
      <Attendance />
    </AuthedPage>
  )
}

function useFence() {
  const { session } = useAuth()
  return useQuery({
    queryKey: ['hr', 'location'],
    queryFn: () => callApi('/hr/location', { responseSchema: companyFence.nullable() }),
    enabled: !!session,
    staleTime: 300_000,
  })
}

function Attendance() {
  const { session } = useAuth()
  // Everyone can see their own record; only the people who run the studio have
  // a roster to look at, so employees land straight on their own history.
  const canSeeTeam = ['super_admin', 'admin', 'manager'].includes(session?.role ?? '')
  const [tab, setTab] = useState<Tab>(canSeeTeam ? 'dashboard' : 'mine')

  return (
    <>
      <PageHeader
        title="Attendance"
        description="Track your team's daily check-ins, check-outs, and attendance status."
        actions={<ClockActions />}
      />

      {canSeeTeam && (
        <SectionTabs<Tab>
          tabs={[
            { value: 'dashboard', label: 'Dashboard' },
            { value: 'mine', label: 'My attendance' },
          ]}
          value={tab}
          onChange={setTab}
        />
      )}

      {tab === 'dashboard' && canSeeTeam ? <TeamDashboard /> : <MyAttendance />}
    </>
  )
}

/** Check in and out. The fence is checked here and again on the server. */
function ClockActions() {
  const qc = useQueryClient()
  const { data: fence } = useFence()

  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: ['attendance'] })
    void qc.invalidateQueries({ queryKey: ['hr', 'attendance'] })
  }

  const checkIn = useMutation({
    mutationFn: (input: CheckInRequest) =>
      callApi('/hr/check-in', { method: 'POST', body: input, responseSchema: idOnly }),
    onSuccess: () => {
      toast.success('Checked in')
      invalidate()
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const checkOut = useMutation({
    mutationFn: () => callApi('/hr/check-out', { method: 'POST', responseSchema: idOnly }),
    onSuccess: () => {
      toast.success('Checked out')
      invalidate()
    },
    onError: (e: Error) => toast.error(e.message),
  })

  function doCheckIn() {
    const send = (lat: number, lng: number) => {
      // A local check saves a doomed round trip and gives a clearer reason; the
      // server still refuses anything outside the fence either way.
      if (fence && !withinFence({ lat, lng }, { lat: fence.lat, lng: fence.lng }, fence.radius_m)) {
        toast.error('You appear to be outside the studio fence.')
        return
      }
      checkIn.mutate({ lat, lng })
    }
    if (!navigator.geolocation) {
      toast.error('This browser cannot share your location, so check-in is unavailable.')
      return
    }
    navigator.geolocation.getCurrentPosition(
      (p) => send(p.coords.latitude, p.coords.longitude),
      () => toast.error('Allow location access to check in.'),
    )
  }

  return (
    <div className="flex items-center gap-2">
      <Button variant="outline" onClick={() => checkOut.mutate()} disabled={checkOut.isPending}>
        <LogOut /> {checkOut.isPending ? 'Checking out…' : 'Check out'}
      </Button>
      <Button onClick={doCheckIn} disabled={checkIn.isPending}>
        <LogIn /> {checkIn.isPending ? 'Checking in…' : 'Check in'}
      </Button>
    </div>
  )
}

function TeamDashboard() {
  const { session } = useAuth()
  const [date, setDate] = useState(todayISO())
  const [filters, setFilters] = useState<AttendanceFilters>(EMPTY_FILTERS)
  const { data: fence } = useFence()

  const { data, isLoading, isError, refetch, isFetching } = useQuery({
    queryKey: ['hr', 'attendance', date],
    queryFn: () => callApi(`/hr/attendance?date=${date}`, { responseSchema: dayList }),
    staleTime: 15_000,
  })

  const rows = useMemo(() => data ?? [], [data])
  const shown = useMemo(() => filterRows(rows, filters), [rows, filters])
  const totals = useMemo(() => summarise(rows), [rows])

  function exportCsv() {
    const blob = new Blob([toCsv(shown)], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `attendance-${date}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <>
      <HowToUse
        title="Track attendance"
        description="See who checked in, who checked out, and who never arrived."
        steps={[
          'Set the attendance location first.',
          'Ask your team to check in from the studio.',
          'Review the day here.',
        ]}
      />

      {!fence && session?.is_owner && (
        <div className="mt-4 flex flex-wrap items-center gap-3 rounded-xl border border-warning/30 bg-warning/10 p-4">
          <MapPin className="size-4 shrink-0 text-warning" />
          <p className="min-w-0 flex-1 text-sm">
            No attendance location set. Until there is one, anybody can check in from anywhere.
          </p>
          <FenceDialog />
        </div>
      )}

      <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <Tile label="Total" value={totals.total} />
        <Tile label="Present" value={totals.present} tone="success" />
        <Tile label="Absent" value={totals.absent} tone="danger" />
        <Tile label="Not checked out" value={totals.notCheckedOut} tone="info" />
        <Tile label="Attendance" value={`${totals.percent}%`} tone="neutral" />
      </div>

      <div className="mt-4 grid gap-3 rounded-xl border border-border bg-card p-4 sm:grid-cols-2 lg:grid-cols-5">
        <div className="flex flex-col gap-1.5">
          <Label>Date</Label>
          <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </div>
        <div className="flex flex-col gap-1.5 lg:col-span-2">
          <Label>Search</Label>
          <Input
            value={filters.search}
            onChange={(e) => setFilters({ ...filters, search: e.target.value })}
            placeholder="Name, email or phone"
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label>Status</Label>
          <Select
            value={filters.status}
            onChange={(e) =>
              setFilters({ ...filters, status: e.target.value as AttendanceFilters['status'] })
            }
          >
            <option value="all">All</option>
            {(['present', 'late', 'absent', 'not_checked_out'] as DisplayStatus[]).map((s) => (
              <option key={s} value={s}>
                {STATUS_LABEL[s]}
              </option>
            ))}
          </Select>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label>Type</Label>
          <Select
            value={filters.type}
            onChange={(e) => setFilters({ ...filters, type: e.target.value })}
          >
            <option value="">All</option>
            <option value="in_house">In-house</option>
            <option value="freelancer">Freelancer</option>
          </Select>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Button variant="outline" size="sm" onClick={() => void refetch()} disabled={isFetching}>
          <RefreshCw className={cn(isFetching && 'animate-spin')} /> Refresh
        </Button>
        <Button variant="outline" size="sm" onClick={exportCsv} disabled={shown.length === 0}>
          <Download /> CSV
        </Button>
        {hasFilters(filters) && (
          <Button variant="ghost" size="sm" onClick={() => setFilters(EMPTY_FILTERS)}>
            Clear filters
          </Button>
        )}
        <span className="ml-auto text-xs text-muted-foreground">
          Showing {shown.length} of {rows.length}
        </span>
      </div>

      <div className="mt-4">
        {isLoading ? (
          <SkeletonTable rows={5} columns={5} />
        ) : isError ? (
          <ErrorState onRetry={() => void refetch()} />
        ) : shown.length === 0 ? (
          <Card>
            <CardContent className="py-4">
              <EmptyState
                title={
                  rows.length === 0
                    ? 'No attendance records found for this date.'
                    : 'Nobody matches these filters.'
                }
                description={
                  rows.length === 0
                    ? 'Try a different date, or ask your team to check in.'
                    : 'Clear a filter to widen the list.'
                }
              />
            </CardContent>
          </Card>
        ) : (
          <RosterTable rows={shown} />
        )}
      </div>

      <p className="mt-4 text-xs text-muted-foreground">
        Absent means no check-in was recorded for the date. Manual correction is not built yet.
      </p>
    </>
  )
}

function Tile({
  label,
  value,
  tone = 'neutral',
}: {
  label: string
  value: number | string
  tone?: 'success' | 'danger' | 'info' | 'neutral'
}) {
  const toneClass = {
    success: 'text-success',
    danger: 'text-destructive',
    info: 'text-primary',
    neutral: 'text-foreground',
  }[tone]
  return (
    <Card>
      <CardContent className="p-4">
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className={cn('mt-1 text-2xl font-semibold tabular-nums', toneClass)}>
          {typeof value === 'number' ? <CountUp value={value} /> : value}
        </p>
      </CardContent>
    </Card>
  )
}

function RosterTable({ rows }: { rows: readonly AttendanceDayRow[] }) {
  const isMobile = useIsMobile()

  if (isMobile) {
    return (
      <div className="flex flex-col gap-3">
        {rows.map((r) => {
          const status = displayStatus(r)
          return (
            <div key={r.user_id} className="rounded-lg border border-border p-4">
              <div className="flex items-start justify-between gap-2">
                <p className="truncate font-medium">{r.name}</p>
                <StatusBadge tone={STATUS_TONE[status]}>{STATUS_LABEL[status]}</StatusBadge>
              </div>
              <p className="mt-1 text-sm text-muted-foreground">
                In {formatTime(r.check_in_at)} · Out {formatTime(r.check_out_at)}
              </p>
            </div>
          )
        })}
      </div>
    )
  }

  return (
    <div className="table-wrap rounded-lg border border-border">
      <table className="table-sticky w-full text-sm">
        <thead className="bg-muted/50 text-left text-muted-foreground">
          <tr>
            <th className="min-w-48 px-4 py-2 font-medium">Name</th>
            <th className="px-4 py-2 font-medium">Status</th>
            <th className="px-4 py-2 font-medium">Checked in</th>
            <th className="px-4 py-2 font-medium">Checked out</th>
            <th className="px-4 py-2 text-right font-medium">Hours</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const status = displayStatus(r)
            const hours = hoursWorked(r)
            return (
              <tr key={r.user_id} className="border-t border-border hover:bg-muted/30">
                <td className="px-4 py-2">
                  <span className="flex items-center gap-2 font-medium">
                    <Avatar name={r.name} size="sm" />
                    {r.name}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {r.engagement_type === 'freelancer' ? 'Freelancer' : 'In-house'}
                  </span>
                </td>
                <td className="px-4 py-2">
                  <StatusBadge tone={STATUS_TONE[status]}>{STATUS_LABEL[status]}</StatusBadge>
                </td>
                <td className="px-4 py-2 text-muted-foreground">{formatTime(r.check_in_at)}</td>
                <td className="px-4 py-2 text-muted-foreground">{formatTime(r.check_out_at)}</td>
                <td className="px-4 py-2 text-right tabular-nums">{hours === null ? '—' : hours}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

function MyAttendance() {
  const { session } = useAuth()
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['attendance', 'my'],
    queryFn: () => callApi('/hr/attendance/my', { responseSchema: myList }),
    enabled: !!session,
    staleTime: 15_000,
  })

  if (isLoading) return <SkeletonList rows={5} columns={6} />
  if (isError) return <ErrorState onRetry={() => void refetch()} />
  if (!data || data.length === 0) {
    return (
      <Card>
        <CardContent className="py-4">
          <EmptyState title="No attendance yet" description="Check in to start your record." />
        </CardContent>
      </Card>
    )
  }

  return (
    <div className="flex flex-col gap-2">
      {data.map((a) => (
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
  )
}

/** Owner-only: pin the studio, so check-in can be refused from anywhere else. */
function FenceDialog() {
  const qc = useQueryClient()
  const { data: fence } = useFence()
  const [open, setOpen] = useState(false)
  const [lat, setLat] = useState(String(fence?.lat ?? ''))
  const [lng, setLng] = useState(String(fence?.lng ?? ''))
  const [radius, setRadius] = useState(String(fence?.radius_m ?? 150))
  const [error, setError] = useState<string | null>(null)

  const save = useMutation({
    mutationFn: (input: SetFenceRequest) =>
      callApi('/hr/location', { method: 'PATCH', body: input, responseSchema: companyFence }),
    onSuccess: () => {
      toast.success('Attendance location saved')
      void qc.invalidateQueries({ queryKey: ['hr', 'location'] })
      setOpen(false)
    },
    onError: (e: Error) => toast.error(e.message),
  })

  function useMyLocation() {
    if (!navigator.geolocation) {
      setError('This browser cannot share a location.')
      return
    }
    navigator.geolocation.getCurrentPosition(
      (p) => {
        setLat(String(p.coords.latitude))
        setLng(String(p.coords.longitude))
        setError(null)
      },
      () => setError('Allow location access, or type the coordinates in.'),
    )
  }

  function onSave() {
    const parsed = setFenceRequest.safeParse({
      lat: Number(lat),
      lng: Number(lng),
      radius_m: Number(radius),
      timezone: fence?.timezone ?? 'Asia/Kolkata',
    })
    if (!parsed.success) {
      setError('Check the coordinates and a radius between 20 and 5000 metres.')
      return
    }
    save.mutate(parsed.data)
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm">
          <MapPin /> Set location
        </Button>
      </DialogTrigger>
      <DialogContent
        title="Attendance location"
        description="Check-ins are refused from outside this circle."
      >
        <div className="flex flex-col gap-3">
          <Button variant="outline" onClick={useMyLocation}>
            <MapPin /> Use my current location
          </Button>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <Label>Latitude</Label>
              <Input value={lat} onChange={(e) => setLat(e.target.value)} placeholder="19.0760" />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>Longitude</Label>
              <Input value={lng} onChange={(e) => setLng(e.target.value)} placeholder="72.8777" />
            </div>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>Radius (metres)</Label>
            <Input value={radius} onChange={(e) => setRadius(e.target.value)} placeholder="150" />
            <p className="text-xs text-muted-foreground">
              Between 20 and 5000. Too tight and GPS drift alone locks people out.
            </p>
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <div className="flex justify-end gap-2">
            <DialogClose asChild>
              <Button type="button" variant="outline">
                Cancel
              </Button>
            </DialogClose>
            <Button onClick={onSave} disabled={save.isPending}>
              {save.isPending ? 'Saving…' : 'Save location'}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
