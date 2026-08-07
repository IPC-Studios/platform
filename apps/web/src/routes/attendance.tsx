import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { MapPin, Clock } from 'lucide-react'
import { attendanceRecord, companyFence, z, type CheckInRequest } from '@ipc/contracts'
import { withinFence } from '@ipc/domain'
import { callApi } from '@/shared/api/client'
import { useAuth } from '@/shared/auth/AuthProvider'
import { AuthedPage } from '@/shared/layout/AuthedPage'
import { PageHeader } from '@/shared/layout/page-header'
import { Button } from '@/shared/ui/button'
import { Card, CardContent } from '@/shared/ui/card'
import { StatusBadge } from '@/shared/ui/status-badge'
import { LoadingState, ErrorState, EmptyState } from '@/shared/ui/states'

const list = attendanceRecord.array()
const TONE = { present: 'success', late: 'warning', absent: 'danger' } as const

function useMyAttendance() {
  const { session } = useAuth()
  return useQuery({
    queryKey: ['attendance', 'my'],
    queryFn: () => callApi('/hr/attendance/my', { responseSchema: list }),
    enabled: !!session,
    staleTime: 15_000,
  })
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

function useCheckIn() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: CheckInRequest) =>
      callApi('/hr/check-in', { method: 'POST', body: input, responseSchema: z.object({ id: z.string() }) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['attendance', 'my'] }),
  })
}

export function AttendancePage() {
  return (
    <AuthedPage module="attendance">
      <Attendance />
    </AuthedPage>
  )
}

function Attendance() {
  const { data, isLoading, isError, refetch } = useMyAttendance()
  const { data: fence } = useFence()
  const checkIn = useCheckIn()
  const [msg, setMsg] = useState<string | null>(null)

  function doCheckIn() {
    setMsg(null)
    const send = (lat: number, lng: number) => {
      if (fence && !withinFence({ lat, lng }, { lat: fence.lat, lng: fence.lng }, fence.radius_m)) {
        setMsg('You appear to be outside the studio fence.')
        return
      }
      checkIn.mutate({ lat, lng }, { onError: (e) => setMsg(e instanceof Error ? e.message : 'Check-in failed.') })
    }
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (p) => send(p.coords.latitude, p.coords.longitude),
        () => send(fence?.lat ?? 19.076, fence?.lng ?? 72.8777), // fallback to studio (demo)
      )
    } else {
      send(fence?.lat ?? 19.076, fence?.lng ?? 72.8777)
    }
  }

  return (
    <>
      <PageHeader
        title="Attendance"
        description="Check in from the studio. Location is verified."
        actions={
          <Button onClick={doCheckIn} disabled={checkIn.isPending}>
            <MapPin /> {checkIn.isPending ? 'Checking in…' : 'Check in'}
          </Button>
        }
      />
      {msg && <p className="mb-4 rounded-md bg-warning/10 px-3 py-2 text-sm text-warning">{msg}</p>}

      {isLoading ? (
        <LoadingState />
      ) : isError ? (
        <ErrorState onRetry={() => void refetch()} />
      ) : !data || data.length === 0 ? (
        <EmptyState title="No attendance yet" description="Check in to start your record." />
      ) : (
        <div className="flex flex-col gap-2">
          {data.map((a) => (
            <Card key={a.id}>
              <CardContent className="flex items-center justify-between p-3">
                <span className="flex items-center gap-2 text-sm">
                  <Clock className="size-4 text-muted-foreground" />
                  {a.a_date}
                  {a.check_in_at && (
                    <span className="text-muted-foreground">
                      · in {new Date(a.check_in_at).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}
                    </span>
                  )}
                </span>
                <StatusBadge tone={TONE[a.status]}>{a.status}</StatusBadge>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </>
  )
}
