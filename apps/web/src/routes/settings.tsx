import { useEffect, useState, type FormEvent } from 'react'
import { Link, useNavigate } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Check, Palette } from 'lucide-react'
import { toast } from 'sonner'
import {
  companyProfile,
  companyTheme,
  type UpdateCompanyRequest,
} from '@ipc/contracts'
import { presetFor } from '@/shared/theme/presets'
import { fontOr } from '@/shared/theme/fonts'
import { SettingsTabs } from '@/features/settings/SettingsTabs'
import { callApi } from '@/shared/api/client'
import { useAuth } from '@/shared/auth/AuthProvider'
import { AuthedPage } from '@/shared/layout/AuthedPage'
import { PageHeader } from '@/shared/layout/page-header'
import { Button } from '@/shared/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/shared/ui/card'
import { Input, Label } from '@/shared/ui/input'
import { LoadingState } from '@/shared/ui/states'
import { useConfirm } from '@/shared/ui/confirm'

export function SettingsPage() {
  return (
    <AuthedPage module="settings">
      <Settings />
    </AuthedPage>
  )
}

function Settings() {
  const { session } = useAuth()
  const isOwner = session?.is_owner ?? false
  return (
    <>
      <PageHeader title="Settings" description="Your studio profile and appearance." />
      <SettingsTabs />
      <div className="grid gap-4 lg:grid-cols-2">
        <CompanyCard readOnly={!isOwner} />
        <ThemeCard readOnly={!isOwner} />
        <SecurityCard />
      </div>
    </>
  )
}

function SecurityCard() {
  const { signOutEverywhere } = useAuth()
  const confirm = useConfirm()
  const navigate = useNavigate()
  const [busy, setBusy] = useState(false)

  async function signOutAll() {
    const yes = await confirm({
      title: 'Sign out everywhere?',
      description:
        'Every device signs out, including this one. Use this if you think someone else has access.',
      confirmLabel: 'Sign out everywhere',
      destructive: true,
    })
    if (!yes) return
    setBusy(true)
    try {
      await signOutEverywhere()
    } catch (e) {
      // Never claim the other devices are dead when the revocation failed.
      toast.error(e instanceof Error ? e.message : 'We could not sign out your other devices.')
    } finally {
      setBusy(false)
    }
    await navigate({ to: '/login' })
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Security</CardTitle>
      </CardHeader>
      <CardContent>
        <p className="mb-4 text-sm text-muted-foreground">
          Signs out every browser and device this account is open on. Anyone holding an old session
          loses it immediately.
        </p>
        <Button variant="outline" disabled={busy} onClick={() => void signOutAll()}>
          {busy ? 'Signing out…' : 'Sign out everywhere'}
        </Button>
      </CardContent>
    </Card>
  )
}

function CompanyCard({ readOnly }: { readOnly: boolean }) {
  const qc = useQueryClient()
  const { data, isLoading } = useQuery({
    queryKey: ['settings', 'company'],
    queryFn: () => callApi('/settings/company', { responseSchema: companyProfile }),
  })
  const save = useMutation({
    mutationFn: (input: UpdateCompanyRequest) =>
      callApi('/settings/company', { method: 'PATCH', body: input, responseSchema: companyProfile }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['settings', 'company'] }),
  })

  const [form, setForm] = useState<UpdateCompanyRequest>({})
  const [saved, setSaved] = useState(false)
  useEffect(() => {
    if (data) setForm({ name: data.name, city: data.city ?? '', state: data.state ?? '', invoice_gst_number: data.invoice_gst_number ?? '' })
  }, [data])

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    await save.mutateAsync(form)
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  if (isLoading) return <Card><CardContent className="p-6"><LoadingState /></CardContent></Card>

  return (
    <Card>
      <CardHeader>
        <CardTitle>Studio profile</CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={onSubmit} className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <Label>Studio name</Label>
            <Input value={form.name ?? ''} onChange={(e) => setForm({ ...form, name: e.target.value })} disabled={readOnly} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <Label>City</Label>
              <Input value={form.city ?? ''} onChange={(e) => setForm({ ...form, city: e.target.value })} disabled={readOnly} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>State</Label>
              <Input value={form.state ?? ''} onChange={(e) => setForm({ ...form, state: e.target.value })} disabled={readOnly} />
            </div>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>GST number</Label>
            <Input value={form.invoice_gst_number ?? ''} onChange={(e) => setForm({ ...form, invoice_gst_number: e.target.value })} disabled={readOnly} />
          </div>
          {!readOnly && (
            <div className="flex items-center gap-2">
              <Button type="submit" disabled={save.isPending}>
                {save.isPending ? 'Saving…' : 'Save'}
              </Button>
              {saved && <span className="flex items-center gap-1 text-sm text-success"><Check className="size-4" /> Saved</span>}
            </div>
          )}
        </form>
      </CardContent>
    </Card>
  )
}

function ThemeCard({ readOnly }: { readOnly: boolean }) {
  const { data } = useQuery({
    queryKey: ['settings', 'theme'],
    queryFn: () => callApi('/settings/theme', { responseSchema: companyTheme }),
  })
  const preset = presetFor(data?.preset_key)
  const font = fontOr(data?.font_key, preset.font)

  return (
    <Card>
      <CardHeader>
        <CardTitle>Theme & branding</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="flex items-center gap-3">
          <span className="size-9 shrink-0 rounded-lg" style={{ backgroundColor: preset.swatch }} />
          <div className="min-w-0">
            <p className="truncate font-medium">{preset.label}</p>
            <p className="truncate text-sm text-muted-foreground">
              {font.family} · {preset.description}
            </p>
          </div>
        </div>
        <Button variant="outline" className="mt-4" asChild>
          <Link to="/settings/appearance">
            <Palette /> {readOnly ? 'View themes' : 'Change theme & font'}
          </Link>
        </Button>
      </CardContent>
    </Card>
  )
}
