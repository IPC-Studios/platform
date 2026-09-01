import { useEffect, useState, type FormEvent, type ReactNode } from 'react'
import { Link, useNavigate } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Check, Palette } from 'lucide-react'
import { toast } from 'sonner'
import {
  companyProfile,
  companyTheme,
  myProfile,
  type UpdateCompanyRequest,
  type UpdateMyProfileRequest,
} from '@ipc/contracts'
import { presetFor } from '@/shared/theme/presets'
import { fontOr } from '@/shared/theme/fonts'
import { SettingsTabs } from '@/features/settings/SettingsTabs'
import { callApi } from '@/shared/api/client'
import { useAuth } from '@/shared/auth/AuthProvider'
import { AuthedPage } from '@/shared/layout/AuthedPage'
import { PageHeader } from '@/shared/layout/page-header'
import { Button } from '@/shared/ui/button'
import { Card, CardContent } from '@/shared/ui/card'
import { HowToUse } from '@/shared/ui/how-to-use'
import { Input, Label } from '@/shared/ui/input'
import { StatusBadge } from '@/shared/ui/status-badge'
import { LoadingState } from '@/shared/ui/states'
import { humanize } from '@/shared/ui/format'
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
      <PageHeader
        title="Settings"
        description="Manage your company profile, roles and subscription."
      />
      <SettingsTabs />

      <h2 className="text-lg font-semibold tracking-tight">Company profile</h2>
      <p className="mt-0.5 text-sm text-muted-foreground">
        View and update your company and admin profile.
      </p>

      <HowToUse
        className="mt-4"
        title="Manage studio settings"
        description="Update your company profile, job roles, appearance, and plan."
        steps={['Update company details.', 'Manage roles and access.', 'Pick your theme and font.']}
      />

      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <ProfileCard className="lg:col-span-2" canEditCompany={isOwner} />
        <AccountStatusCard />
      </div>

      <BrandIdentityCard readOnly={!isOwner} />

      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <ThemeSummaryCard readOnly={!isOwner} className="lg:col-span-2" />
        <SecurityCard />
      </div>
    </>
  )
}

function Section({
  title,
  description,
  children,
}: {
  title: string
  description: string
  children: ReactNode
}) {
  return (
    <Card className="mt-4">
      <CardContent className="p-5 sm:p-6">
        <h3 className="font-semibold tracking-tight">{title}</h3>
        <p className="mt-0.5 text-sm text-muted-foreground">{description}</p>
        <div className="mt-5">{children}</div>
      </CardContent>
    </Card>
  )
}

function Field({
  label,
  required,
  hint,
  children,
}: {
  label: string
  required?: boolean
  hint?: string | undefined
  children: ReactNode
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label>
        {label}
        {required && <span className="ml-0.5 text-destructive">*</span>}
      </Label>
      {children}
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  )
}

/**
 * The company's name and the signed-in person's own details, saved together —
 * which is how they read on screen, even though they are two rows in two
 * tables. Only an owner may rename the studio; anyone may fix their own name.
 */
function ProfileCard({ className, canEditCompany }: { className?: string; canEditCompany: boolean }) {
  const qc = useQueryClient()
  const { refresh } = useAuth()

  const company = useQuery({
    queryKey: ['settings', 'company'],
    queryFn: () => callApi('/settings/company', { responseSchema: companyProfile }),
  })
  const profile = useQuery({
    queryKey: ['settings', 'profile'],
    queryFn: () => callApi('/settings/profile', { responseSchema: myProfile }),
  })

  const saveCompany = useMutation({
    mutationFn: (input: UpdateCompanyRequest) =>
      callApi('/settings/company', { method: 'PATCH', body: input, responseSchema: companyProfile }),
  })
  const saveProfile = useMutation({
    mutationFn: (input: UpdateMyProfileRequest) =>
      callApi('/settings/profile', { method: 'PATCH', body: input, responseSchema: myProfile }),
  })

  const [companyName, setCompanyName] = useState('')
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [saved, setSaved] = useState(false)

  function reset() {
    setCompanyName(company.data?.name ?? '')
    setName(profile.data?.name ?? '')
    setPhone(profile.data?.phone ?? '')
    setSaved(false)
  }
  useEffect(reset, [company.data, profile.data])

  const dirty =
    companyName !== (company.data?.name ?? '') ||
    name !== (profile.data?.name ?? '') ||
    phone !== (profile.data?.phone ?? '')
  const busy = saveCompany.isPending || saveProfile.isPending

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    try {
      // Two writes, because they are two records. The company one only goes out
      // when it actually changed, so a manager saving their phone is never
      // refused for a studio rename they did not make.
      if (canEditCompany && companyName !== company.data?.name) {
        await saveCompany.mutateAsync({ name: companyName.trim() })
      }
      if (name !== profile.data?.name || phone !== (profile.data?.phone ?? '')) {
        await saveProfile.mutateAsync({ name: name.trim(), phone: phone.trim() || null })
      }
      await qc.invalidateQueries({ queryKey: ['settings'] })
      await refresh()
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'We could not save your changes.')
    }
  }

  if (company.isLoading || profile.isLoading) {
    return (
      <Card className={className}>
        <CardContent className="p-6">
          <LoadingState />
        </CardContent>
      </Card>
    )
  }

  return (
    <Card className={className}>
      <CardContent className="p-5 sm:p-6">
        <h3 className="font-semibold tracking-tight">Profile</h3>
        <p className="mt-0.5 text-sm text-muted-foreground">Editable fields are saved together.</p>

        <form onSubmit={onSubmit} className="mt-5 flex flex-col gap-4">
          <Field
            label="Company name"
            required
            hint={canEditCompany ? undefined : 'Only the studio owner can rename the studio.'}
          >
            <Input
              value={companyName}
              onChange={(e) => setCompanyName(e.target.value)}
              disabled={!canEditCompany}
            />
          </Field>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Your name" required>
              <Input value={name} onChange={(e) => setName(e.target.value)} />
            </Field>
            <Field label="Email" hint="This is your login, so it is not editable here.">
              <Input value={profile.data?.email ?? ''} disabled />
            </Field>
            <Field label="Phone">
              <Input
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="9876543210"
              />
            </Field>
          </div>

          <div className="flex items-center justify-end gap-2">
            {saved && (
              <span className="mr-auto flex items-center gap-1 text-sm text-success">
                <Check className="size-4" /> Saved
              </span>
            )}
            <Button type="button" variant="outline" onClick={reset} disabled={!dirty || busy}>
              Cancel
            </Button>
            <Button type="submit" disabled={!dirty || busy || name.trim().length < 2}>
              {busy ? 'Saving…' : 'Save changes'}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  )
}

/** Read-only facts about this account — role, status, and where the plan stands. */
function AccountStatusCard() {
  const { session } = useAuth()
  const profile = useQuery({
    queryKey: ['settings', 'profile'],
    queryFn: () => callApi('/settings/profile', { responseSchema: myProfile }),
  })

  const expiry = session?.plan_expiry ? new Date(session.plan_expiry) : null
  const daysLeft = expiry ? Math.max(0, Math.ceil((expiry.getTime() - Date.now()) / 86_400_000)) : null
  const gate = session?.plan_gate ?? 'expired'
  const active = gate === 'active' || gate === 'grandfathered'

  return (
    <Card>
      <CardContent className="p-5 sm:p-6">
        <h3 className="font-semibold tracking-tight">Account status</h3>
        <dl className="mt-4 flex flex-col gap-3 text-sm">
          <Row label="Your role">
            <StatusBadge tone="info">{humanize(session?.role ?? 'none')}</StatusBadge>
          </Row>
          <Row label="Status">
            <StatusBadge tone={profile.data?.status === 'active' ? 'success' : 'neutral'}>
              {humanize(profile.data?.status ?? 'active')}
            </StatusBadge>
          </Row>
          <Row label="Plan">
            <span className="font-medium">{humanize(gate)}</span>
          </Row>
          <Row label="Plan expiry">
            <span className="font-medium">{expiry ? expiry.toLocaleDateString('en-IN') : '—'}</span>
          </Row>
          <Row label="Days remaining">
            <span className="font-medium tabular-nums">{daysLeft ?? '—'}</span>
          </Row>
          <Row label="Plan active">
            <StatusBadge tone={active ? 'success' : 'danger'}>
              {active ? 'Active' : 'Expired'}
            </StatusBadge>
          </Row>
        </dl>
        <Button variant="outline" className="mt-5 w-full" asChild>
          <Link to="/settings/subscription">Manage subscription</Link>
        </Button>
      </CardContent>
    </Card>
  )
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <dt className="text-muted-foreground">{label}</dt>
      <dd>{children}</dd>
    </div>
  )
}

/** What clients see on quotations and invoices, as against the studio's own name. */
function BrandIdentityCard({ readOnly }: { readOnly: boolean }) {
  const qc = useQueryClient()
  const { data, isLoading } = useQuery({
    queryKey: ['settings', 'company'],
    queryFn: () => callApi('/settings/company', { responseSchema: companyProfile }),
  })
  const save = useMutation({
    mutationFn: (input: UpdateCompanyRequest) =>
      callApi('/settings/company', { method: 'PATCH', body: input, responseSchema: companyProfile }),
    onSuccess: () => {
      toast.success('Brand details saved')
      void qc.invalidateQueries({ queryKey: ['settings', 'company'] })
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const [form, setForm] = useState<UpdateCompanyRequest>({})
  useEffect(() => {
    if (!data) return
    setForm({
      display_name: data.display_name ?? '',
      legal_name: data.legal_name ?? '',
      invoice_gst_number: data.invoice_gst_number ?? '',
      website: data.website ?? '',
      city: data.city ?? '',
      state: data.state ?? '',
    })
  }, [data])

  if (isLoading) return null
  const set = (patch: UpdateCompanyRequest) => setForm((f) => ({ ...f, ...patch }))

  return (
    <Section
      title="Brand identity"
      description="Used on quotations, invoices, and future client documents."
    >
      <form
        onSubmit={(e) => {
          e.preventDefault()
          save.mutate(form)
        }}
        className="flex flex-col gap-4"
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Display name" hint="The name clients see.">
            <Input
              value={form.display_name ?? ''}
              onChange={(e) => set({ display_name: e.target.value })}
              disabled={readOnly}
              placeholder="IPC Studios"
            />
          </Field>
          <Field label="Legal company name" hint="Printed on invoices.">
            <Input
              value={form.legal_name ?? ''}
              onChange={(e) => set({ legal_name: e.target.value })}
              disabled={readOnly}
              placeholder="IPC Studios Pvt. Ltd."
            />
          </Field>
          <Field label="GST number">
            <Input
              value={form.invoice_gst_number ?? ''}
              onChange={(e) => set({ invoice_gst_number: e.target.value })}
              disabled={readOnly}
              placeholder="27AAAAA0000A1Z5"
            />
          </Field>
          <Field label="Website">
            <Input
              value={form.website ?? ''}
              onChange={(e) => set({ website: e.target.value })}
              disabled={readOnly}
              placeholder="ipcstudios.in"
            />
          </Field>
          <Field label="City">
            <Input
              value={form.city ?? ''}
              onChange={(e) => set({ city: e.target.value })}
              disabled={readOnly}
            />
          </Field>
          <Field label="State">
            <Input
              value={form.state ?? ''}
              onChange={(e) => set({ state: e.target.value })}
              disabled={readOnly}
            />
          </Field>
        </div>
        {!readOnly && (
          <div className="flex justify-end">
            <Button type="submit" disabled={save.isPending}>
              {save.isPending ? 'Saving…' : 'Save brand details'}
            </Button>
          </div>
        )}
      </form>
    </Section>
  )
}

function ThemeSummaryCard({ readOnly, className }: { readOnly: boolean; className?: string }) {
  const { data } = useQuery({
    queryKey: ['settings', 'theme'],
    queryFn: () => callApi('/settings/theme', { responseSchema: companyTheme }),
  })
  const preset = presetFor(data?.preset_key)
  const font = fontOr(data?.font_key, preset.font)

  return (
    <Card className={className}>
      <CardContent className="p-5 sm:p-6">
        <h3 className="font-semibold tracking-tight">Theme &amp; branding</h3>
        <p className="mt-0.5 text-sm text-muted-foreground">
          The palette and typeface your whole studio sees.
        </p>
        <div className="mt-4 flex items-center gap-3">
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
      <CardContent className="p-5 sm:p-6">
        <h3 className="font-semibold tracking-tight">Security</h3>
        <p className="mt-0.5 text-sm text-muted-foreground">
          Signs out every browser and device this account is open on.
        </p>
        <Button variant="outline" className="mt-4" disabled={busy} onClick={() => void signOutAll()}>
          {busy ? 'Signing out…' : 'Sign out everywhere'}
        </Button>
      </CardContent>
    </Card>
  )
}
