import { useEffect, useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Loader2, MapPin } from 'lucide-react'
import { companyFence, setFenceRequest } from '@ipc/contracts'
import { callApi } from '@/shared/api/client'
import { useAuth } from '@/shared/auth/AuthProvider'
import { AuthedPage } from '@/shared/layout/AuthedPage'
import { PageHeader } from '@/shared/layout/page-header'
import { SettingsTabs } from '@/features/settings/SettingsTabs'
import { Button } from '@/shared/ui/button'
import { Card, CardContent } from '@/shared/ui/card'
import { Input, Label } from '@/shared/ui/input'
import { Switch } from '@/shared/ui/switch'
import { HowToUse } from '@/shared/ui/how-to-use'

export function AttendanceLocationPage() {
  return (
    <AuthedPage module="settings">
      <AttendanceLocation />
    </AuthedPage>
  )
}

/**
 * Lovable parity (/settings/attendance-location): geo-fence employees must be
 * inside to check in. Wired to the existing /hr/location endpoint.
 */
function AttendanceLocation() {
  const { session } = useAuth()
  const qc = useQueryClient()
  const isOwner = session?.is_owner ?? false
  const fence = useQuery({
    queryKey: ['hr', 'location'],
    queryFn: () => callApi('/hr/location', { responseSchema: companyFence.nullable() }),
    enabled: !!session,
  })
  const save = useMutation({
    mutationFn: (body: { lat: number; lng: number; radius_m: number; is_active: boolean }) =>
      callApi('/hr/location', { method: 'PATCH', body: setFenceRequest.parse({ ...body, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone }), responseSchema: companyFence }),
    onSuccess: () => {
      toast.success('Attendance location updated.')
      void qc.invalidateQueries({ queryKey: ['hr', 'location'] })
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const [lat, setLat] = useState('')
  const [lng, setLng] = useState('')
  const [radius, setRadius] = useState('100')
  const [active, setActive] = useState(true)
  const [locating, setLocating] = useState(false)

  useEffect(() => {
    if (fence.data) {
      setLat(String(fence.data.lat))
      setLng(String(fence.data.lng))
      setRadius(String(fence.data.radius_m))
      setActive(fence.data.is_active)
    }
  }, [fence.data])

  async function useMyLocation() {
    setLocating(true)
    try {
      const pos = await new Promise<GeolocationPosition>((res, rej) =>
        navigator.geolocation.getCurrentPosition(res, rej),
      )
      setLat(pos.coords.latitude.toFixed(6))
      setLng(pos.coords.longitude.toFixed(6))
      toast.success('Current location applied.')
    } catch {
      toast.error('Unable to get your location.')
    } finally {
      setLocating(false)
    }
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    const la = Number(lat)
    const ln = Number(lng)
    const r = Number(radius)
    if (!Number.isFinite(la) || la < -90 || la > 90) return toast.error('Latitude must be between -90 and 90.')
    if (!Number.isFinite(ln) || ln < -180 || ln > 180) return toast.error('Longitude must be between -180 and 180.')
    if (!Number.isFinite(r) || r < 20 || r > 5000) return toast.error('Radius must be between 20 and 5000 meters.')
    save.mutate({ lat: la, lng: ln, radius_m: Math.round(r), is_active: active })
  }

  return (
    <>
      <PageHeader title="Attendance Location" description="Configure the geo-fence employees must be inside to check in." />
      <SettingsTabs />
      <HowToUse
        title="Set attendance location"
        description="Set your studio or office location for team check-ins."
        steps={['Add your studio location.', 'Set allowed radius.', 'Save before asking team to check in.']}
      />
      {!isOwner ? (
        <Card className="mt-4">
          <CardContent className="p-6 text-sm text-muted-foreground">
            Only the studio owner can manage the attendance location.
          </CardContent>
        </Card>
      ) : (
        <Card className="mt-4 max-w-xl">
          <CardContent className="p-5 sm:p-6">
            {!fence.data && !fence.isLoading && (
              <p className="mb-4 rounded-lg border border-warning/40 bg-warning/10 p-3 text-sm">
                Employees cannot check in until attendance location is configured.
              </p>
            )}
            <form onSubmit={onSubmit} className="grid gap-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="flex flex-col gap-1.5">
                  <Label>Latitude</Label>
                  <Input value={lat} onChange={(e) => setLat(e.target.value)} placeholder="e.g. 28.6139" required />
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label>Longitude</Label>
                  <Input value={lng} onChange={(e) => setLng(e.target.value)} placeholder="e.g. 77.2090" required />
                </div>
              </div>
              <Button type="button" variant="outline" onClick={() => void useMyLocation()} disabled={locating} className="w-fit">
                {locating ? <Loader2 className="mr-2 size-4 animate-spin" /> : <MapPin className="mr-2 size-4" />}
                Use my current location
              </Button>
              <div className="flex flex-col gap-1.5">
                <Label>Radius (meters)</Label>
                <Input type="number" min={20} max={5000} value={radius} onChange={(e) => setRadius(e.target.value)} required />
                <p className="text-xs text-muted-foreground">Employees must be within this radius to check in.</p>
              </div>
              <div className="rounded-lg border border-border p-3">
                <Switch checked={active} onChange={setActive} label="Enforce geo-fence" description="When off, check-in still works but location is not validated." />
              </div>
              <div>
                <Button type="submit" disabled={save.isPending}>
                  {save.isPending ? 'Saving…' : 'Save location'}
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      )}
    </>
  )
}
