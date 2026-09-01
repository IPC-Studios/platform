import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import {
  ArrowLeft,
  ArrowRight,
  CalendarDays,
  Camera,
  CheckCircle2,
  Package,
  Plus,
  RotateCcw,
  Search,
  Sparkles,
  Trash2,
  UserPlus,
  Users,
  Wallet,
} from 'lucide-react'
import { z, type CreateShootRequest } from '@ipc/contracts'
import { callApi } from '@/shared/api/client'
import { AuthedPage } from '@/shared/layout/AuthedPage'
import { Breadcrumbs } from '@/shared/layout/breadcrumbs'
import { PageHeader } from '@/shared/layout/page-header'
import { Button } from '@/shared/ui/button'
import { Card, CardContent } from '@/shared/ui/card'
import { cn } from '@/shared/ui/cn'
import { Input, Label, Select } from '@/shared/ui/input'
import { formatINR } from '@/shared/ui/format'
import { StatusBadge } from '@/shared/ui/status-badge'
import { Stepper } from '@/shared/ui/stepper'
import { Switch } from '@/shared/ui/switch'
import { useConfirm } from '@/shared/ui/confirm'
import { scrollIntoView } from '@/shared/ui/motion'
import { useClients, useCreateClient } from '@/features/clients/api'
import { useCreateProject } from '@/features/projects/api'
import {
  EMPTY_DRAFT,
  STEP_HINTS,
  STEP_LABELS,
  WIZARD_STEPS,
  canSubmit,
  clearDraft,
  draftTotals,
  estimatedDateFor,
  isDirty,
  loadDraft,
  newDeliverable,
  newPayment,
  newShoot,
  nextStep,
  prevStep,
  saveDraft,
  stepErrors,
  stepIndex,
  toProjectRequest,
  toShootRequests,
  type DeliverableDraft,
  type ProjectDraft,
  type ShootDraft,
  type WizardStep,
} from '@/features/projects/wizard'

const dayFormat = new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })
const prettyDate = (iso: string) => dayFormat.format(new Date(`${iso}T00:00:00`))

export function NewProjectPage() {
  return (
    <AuthedPage module="projects">
      <NewProject />
    </AuthedPage>
  )
}

function NewProject() {
  const navigate = useNavigate()
  const qc = useQueryClient()
  const confirm = useConfirm()
  const createClient = useCreateClient()
  const createProject = useCreateProject()
  const createShoot = useMutation({
    mutationFn: (input: CreateShootRequest) =>
      callApi('/shoots', { method: 'POST', body: input, responseSchema: z.object({ id: z.string() }) }),
  })

  const [draft, setDraft] = useState<ProjectDraft>(EMPTY_DRAFT)
  const [step, setStep] = useState<WizardStep>('client')
  const [visited, setVisited] = useState<Set<WizardStep>>(new Set(['client']))
  const [showErrors, setShowErrors] = useState(false)
  const [savedAt, setSavedAt] = useState<string | null>(null)
  const [restored, setRestored] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const loaded = useRef(false)
  const sectionRef = useRef<HTMLDivElement>(null)

  const errors = stepErrors(draft)
  const totals = draftTotals(draft)
  const stepError = errors[step]

  // Restore before the first save runs, or the empty initial draft would
  // overwrite the thing we are about to offer back.
  useEffect(() => {
    const stored = loadDraft()
    if (stored && isDirty(stored.draft)) {
      setDraft(stored.draft)
      setRestored(stored.savedAt)
    }
    loaded.current = true
  }, [])

  // Autosave, debounced: typing a project name should not write on every key.
  useEffect(() => {
    if (!loaded.current) return
    const at = new Date().toISOString()
    const timer = setTimeout(() => {
      saveDraft(draft, at)
      setSavedAt(isDirty(draft) ? at : null)
    }, 600)
    return () => clearTimeout(timer)
  }, [draft])

  const patch = (p: Partial<ProjectDraft>) => {
    setDraft((d) => ({ ...d, ...p }))
    setShowErrors(false)
  }

  function goTo(next: WizardStep) {
    setStep(next)
    setVisited((v) => new Set(v).add(next))
    setShowErrors(false)
    // A long step leaves you at its foot; the next question is at the top.
    scrollIntoView(sectionRef.current)
  }

  function onNext() {
    if (stepError) {
      setShowErrors(true)
      return
    }
    goTo(nextStep(step))
  }

  async function onDiscard() {
    const yes = await confirm({
      title: 'Discard this draft?',
      description: 'Everything you have filled in here is cleared. Nothing has been created yet.',
      confirmLabel: 'Discard draft',
      destructive: true,
    })
    if (!yes) return
    clearDraft()
    setDraft(EMPTY_DRAFT)
    setRestored(null)
    setSavedAt(null)
    goTo('client')
  }

  /**
   * Create in order: client (only if new), then project, then shoots. The
   * client is created here rather than on step 1 so an abandoned wizard leaves
   * nothing behind.
   */
  async function onSubmit() {
    setError(null)
    setBusy(true)
    try {
      let clientId = draft.client_id
      if (!clientId) {
        const created = await createClient.mutateAsync({
          name: draft.new_client_name.trim(),
          ...(draft.new_client_phone.trim() ? { phone: draft.new_client_phone.trim() } : {}),
        })
        clientId = created.id
      }

      const { id } = await createProject.mutateAsync(toProjectRequest(draft, clientId))

      // Shoots hang off the project, so they can only be created once it exists.
      // A failure here leaves a real project behind — say so rather than
      // pretending the whole thing failed.
      const shoots = toShootRequests(draft, id)
      const failed: string[] = []
      for (const shoot of shoots) {
        try {
          await createShoot.mutateAsync(shoot)
        } catch {
          failed.push(shoot.name)
        }
      }
      void qc.invalidateQueries({ queryKey: ['shoots'] })

      clearDraft()
      if (failed.length) {
        setError(
          `Project created, but these shoots did not save: ${failed.join(', ')}. Add them from the project.`,
        )
      }
      await navigate({ to: '/projects/$id', params: { id } })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create the project.')
    } finally {
      setBusy(false)
    }
  }

  const invalid = useMemo(
    () => new Set(WIZARD_STEPS.filter((s) => visited.has(s) && errors[s])),
    [visited, errors],
  )

  return (
    <>
      <Breadcrumbs items={[{ label: 'Home', to: '/dashboard' }, { label: 'Projects', to: '/projects' }, { label: 'New' }]} />
      <PageHeader
        title="Create project"
        description="Client, shoots, deliverables and billing — one section at a time."
        actions={
          <Button variant="outline" onClick={() => void navigate({ to: '/projects' })}>
            <ArrowLeft /> Back to projects
          </Button>
        }
      />

      <div className="flex flex-wrap items-center gap-3 rounded-xl border border-border bg-muted/30 p-4">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <Sparkles className="size-4" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium">Guided setup</p>
          <p className="text-xs text-muted-foreground">
            {restored
              ? `Draft restored from ${prettyTime(restored)}. It saves on this device as you type.`
              : 'Your draft saves automatically on this device. Deliverable dates follow your shoot dates.'}
          </p>
        </div>
        <StatusBadge tone={savedAt ? 'success' : 'neutral'}>
          {savedAt ? `Draft saved ${prettyTime(savedAt)}` : 'No draft yet'}
        </StatusBadge>
        {isDirty(draft) && (
          <Button variant="ghost" size="sm" onClick={() => void onDiscard()}>
            <RotateCcw /> Discard
          </Button>
        )}
      </div>

      <Card className="mt-4">
        <CardContent className="flex flex-wrap items-center justify-between gap-3 p-4">
          <Stepper
            steps={WIZARD_STEPS.map((s) => ({ value: s, label: STEP_LABELS[s] }))}
            current={step}
            visited={visited}
            invalid={invalid}
            onJump={goTo}
          />
          <StatusBadge tone="info">
            Step {stepIndex(step) + 1} of {WIZARD_STEPS.length}
          </StatusBadge>
        </CardContent>
      </Card>

      <div ref={sectionRef} className="mt-4 scroll-mt-4">
        <Section title={STEP_LABELS[step]} hint={STEP_HINTS[step]}>
          {step === 'client' && <ClientStep draft={draft} patch={patch} />}
          {step === 'shoots' && <ShootsStep draft={draft} patch={patch} />}
          {step === 'deliverables' && <DeliverablesStep draft={draft} patch={patch} />}
          {step === 'billing' && <BillingStep draft={draft} patch={patch} totals={totals} />}
          {step === 'review' && <ReviewStep draft={draft} totals={totals} errors={errors} onJump={goTo} />}

          {showErrors && stepError && <p className="mt-4 text-sm text-destructive">{stepError}</p>}
          {error && <p className="mt-4 text-sm text-destructive">{error}</p>}
        </Section>
      </div>

      {/* The running total follows you down the flow: the number a studio is
          actually deciding against is the one on the quotation. */}
      <div className="sticky bottom-0 z-30 -mx-4 mt-4 border-t border-border bg-card/95 backdrop-blur md:-mx-6">
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2 p-3 md:px-6 md:py-4">
          <Money label="Package" value={totals.packageCost} />
          <Money label="Add-ons" value={totals.addOns} />
          <Money label="Total" value={totals.total} strong />
          {totals.received > 0 && <Money label="Received" value={totals.received} />}
          {totals.received > 0 && <Money label="Balance" value={totals.balance} />}

          <div className="ml-auto flex items-center gap-2">
            <Button variant="ghost" onClick={() => void navigate({ to: '/projects' })} disabled={busy}>
              Cancel
            </Button>
            <Button
              variant="outline"
              onClick={() => goTo(prevStep(step))}
              disabled={step === 'client' || busy}
            >
              <ArrowLeft /> Back
            </Button>
            {step === 'review' ? (
              <Button onClick={() => void onSubmit()} disabled={!canSubmit(draft) || busy}>
                {busy ? 'Creating…' : 'Create project'}
              </Button>
            ) : (
              <Button onClick={onNext} disabled={busy}>
                Next <ArrowRight />
              </Button>
            )}
          </div>
        </div>
      </div>
    </>
  )
}

const prettyTime = (iso: string) =>
  new Intl.DateTimeFormat('en-IN', { hour: 'numeric', minute: '2-digit' }).format(new Date(iso))

function Money({ label, value, strong }: { label: string; value: number; strong?: boolean }) {
  return (
    <div>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={cn('tabular-nums', strong ? 'text-base font-semibold text-primary' : 'font-medium')}>
        {formatINR(value)}
      </p>
    </div>
  )
}

function Section({ title, hint, children }: { title: string; hint: string; children: ReactNode }) {
  return (
    <Card>
      <CardContent className="p-5 sm:p-6">
        <h2 className="text-lg font-semibold tracking-tight">{title}</h2>
        <p className="mt-0.5 text-sm text-muted-foreground">{hint}</p>
        <div className="mt-5">{children}</div>
      </CardContent>
    </Card>
  )
}

/** A repeated block of rows — shoots, deliverables, payments all share it. */
function RowList({
  items,
  empty,
  addLabel,
  onAdd,
  children,
}: {
  items: unknown[]
  empty: string
  addLabel: string
  onAdd: () => void
  children: ReactNode
}) {
  return (
    <div className="flex flex-col gap-3">
      {items.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
          {empty}
        </p>
      ) : (
        children
      )}
      <div>
        <Button variant="outline" onClick={onAdd}>
          <Plus /> {addLabel}
        </Button>
      </div>
    </div>
  )
}

type Patch = (p: Partial<ProjectDraft>) => void

function Field({ label, required, hint, children }: { label: string; required?: boolean; hint?: string; children: ReactNode }) {
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

function ClientStep({ draft, patch }: { draft: ProjectDraft; patch: Patch }) {
  const { data: clients } = useClients()
  const [mode, setMode] = useState<'existing' | 'new'>(draft.new_client_name ? 'new' : 'existing')
  const [q, setQ] = useState('')

  const matches = (clients ?? []).filter((c) =>
    [c.name, c.phone].filter(Boolean).some((v) => String(v).toLowerCase().includes(q.trim().toLowerCase())),
  )

  return (
    <div className="flex flex-col gap-6">
      <Field label="Project name" required>
        <Input
          value={draft.name}
          onChange={(e) => patch({ name: e.target.value })}
          placeholder="e.g. Aanya & Rahul Wedding"
          autoFocus
        />
      </Field>

      <Switch
        checked={draft.show_quotation}
        onChange={(v) => patch({ show_quotation: v })}
        label="Show quotation to client"
        description="Client-visible deliverables and prices appear on their quotation link."
      />

      <div>
        <Label>Client</Label>
        <div className="mt-2 inline-flex gap-1 rounded-lg bg-muted p-1">
          {(['existing', 'new'] as const).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => {
                setMode(m)
                patch(m === 'new' ? { client_id: '' } : { new_client_name: '', new_client_phone: '' })
              }}
              className={cn(
                'flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
                mode === m ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {m === 'existing' ? <Search className="size-3.5" /> : <UserPlus className="size-3.5" />}
              {m === 'existing' ? 'Existing client' : 'New client'}
            </button>
          ))}
        </div>

        {mode === 'existing' ? (
          <div className="mt-3 flex flex-col gap-2">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Search by name or phone…"
                className="pl-9"
                aria-label="Search clients"
              />
            </div>
            <div className="max-h-64 overflow-y-auto rounded-lg border border-border">
              {matches.length === 0 ? (
                <p className="p-4 text-sm text-muted-foreground">
                  No clients match. Switch to “New client” to add one.
                </p>
              ) : (
                <ul className="divide-y divide-border">
                  {matches.map((c) => (
                    <li key={c.id}>
                      <button
                        type="button"
                        onClick={() => patch({ client_id: c.id })}
                        className={cn(
                          'flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors',
                          draft.client_id === c.id ? 'bg-primary/5' : 'hover:bg-accent',
                        )}
                      >
                        <Users className="size-4 shrink-0 text-muted-foreground" />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-medium">{c.name}</span>
                          <span className="block truncate text-xs text-muted-foreground">
                            {c.phone ?? '—'}
                          </span>
                        </span>
                        {draft.client_id === c.id && <CheckCircle2 className="size-4 text-primary" />}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        ) : (
          <div className="mt-3 grid gap-4 sm:grid-cols-2">
            <Field label="Client name" required>
              <Input
                value={draft.new_client_name}
                onChange={(e) => patch({ new_client_name: e.target.value })}
                placeholder="Sharma Family"
              />
            </Field>
            <Field label="Phone" hint="Optional, but it is how most studios look a client up later.">
              <Input
                value={draft.new_client_phone}
                onChange={(e) => patch({ new_client_phone: e.target.value })}
                placeholder="9876543210"
              />
            </Field>
          </div>
        )}
      </div>
    </div>
  )
}

function ShootsStep({ draft, patch }: { draft: ProjectDraft; patch: Patch }) {
  const set = (i: number, p: Partial<ShootDraft>) =>
    patch({ shoots: draft.shoots.map((s, idx) => (idx === i ? { ...s, ...p } : s)) })

  return (
    <RowList
      items={draft.shoots}
      empty="No shoots yet. You can add them later, but dating deliverables needs at least one."
      addLabel="Add shoot"
      onAdd={() => patch({ shoots: [...draft.shoots, newShoot()] })}
    >
      {draft.shoots.map((s, i) => (
        <div key={i} className="rounded-lg border border-border p-4">
          <div className="mb-3 flex items-center gap-2">
            <Camera className="size-4 text-muted-foreground" />
            <span className="text-sm font-medium">Shoot {i + 1}</span>
            <Button
              variant="ghost"
              size="icon"
              className="ml-auto"
              onClick={() => patch({ shoots: draft.shoots.filter((_, idx) => idx !== i) })}
            >
              <Trash2 />
              <span className="sr-only">Remove shoot {i + 1}</span>
            </Button>
          </div>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Field label="Name" required>
              <Input value={s.name} onChange={(e) => set(i, { name: e.target.value })} placeholder="Wedding day" />
            </Field>
            <Field label="Date">
              <Input type="date" value={s.shoot_date} onChange={(e) => set(i, { shoot_date: e.target.value })} />
            </Field>
            <Field label="Location">
              <Input value={s.location} onChange={(e) => set(i, { location: e.target.value })} placeholder="Taj Lands End" />
            </Field>
            <Field label="Status">
              <Select value={s.status} onChange={(e) => set(i, { status: e.target.value as ShootDraft['status'] })}>
                <option value="planned">Planned</option>
                <option value="confirmed">Confirmed</option>
              </Select>
            </Field>
          </div>
        </div>
      ))}
    </RowList>
  )
}

function DeliverablesStep({ draft, patch }: { draft: ProjectDraft; patch: Patch }) {
  const set = (i: number, p: Partial<DeliverableDraft>) =>
    patch({ deliverables: draft.deliverables.map((d, idx) => (idx === i ? { ...d, ...p } : d)) })

  return (
    <RowList
      items={draft.deliverables}
      empty="Nothing listed yet. Add the album, the film, the reel — whatever the client is promised."
      addLabel="Add deliverable"
      onAdd={() => patch({ deliverables: [...draft.deliverables, newDeliverable()] })}
    >
      {draft.deliverables.map((d, i) => {
        const due = estimatedDateFor(draft, d)
        return (
          <div key={i} className="rounded-lg border border-border p-4">
            <div className="mb-3 flex items-center gap-2">
              <Package className="size-4 text-muted-foreground" />
              <span className="text-sm font-medium">Deliverable {i + 1}</span>
              <Button
                variant="ghost"
                size="icon"
                className="ml-auto"
                onClick={() => patch({ deliverables: draft.deliverables.filter((_, idx) => idx !== i) })}
              >
                <Trash2 />
                <span className="sr-only">Remove deliverable {i + 1}</span>
              </Button>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Title" required>
                <Input value={d.title} onChange={(e) => set(i, { title: e.target.value })} placeholder="Wedding album" />
              </Field>
              <Field label="Starts after">
                <Select
                  value={d.start_rule}
                  onChange={(e) => set(i, { start_rule: e.target.value as DeliverableDraft['start_rule'] })}
                >
                  <option value="whole_project">All shoots are done</option>
                  <option value="this_shoot">One specific shoot</option>
                  <option value="specific_shoots">Selected shoots</option>
                  <option value="no_data">No schedule</option>
                </Select>
              </Field>

              {d.start_rule === 'this_shoot' && (
                <Field label="Which shoot">
                  <Select
                    value={d.shoot_index ?? ''}
                    onChange={(e) => set(i, { shoot_index: e.target.value === '' ? null : Number(e.target.value) })}
                  >
                    <option value="">— Pick a shoot —</option>
                    {draft.shoots.map((s, idx) => (
                      <option key={idx} value={idx}>
                        {s.name || `Shoot ${idx + 1}`}
                        {s.shoot_date ? ` · ${prettyDate(s.shoot_date)}` : ''}
                      </option>
                    ))}
                  </Select>
                </Field>
              )}

              {d.start_rule !== 'no_data' && (
                <Field label="Delivery lead time (days)">
                  <Input
                    inputMode="numeric"
                    value={d.lead_days}
                    onChange={(e) => set(i, { lead_days: e.target.value })}
                    placeholder="45"
                  />
                </Field>
              )}
            </div>

            {d.start_rule !== 'no_data' && (
              <p className="mt-3 flex items-center gap-1.5 text-xs text-muted-foreground">
                <CalendarDays className="size-3.5" />
                {due ? (
                  <>
                    Estimated delivery <span className="font-medium text-foreground">{prettyDate(due)}</span>
                  </>
                ) : (
                  'Estimated delivery appears once the shoot has a date and a lead time.'
                )}
              </p>
            )}

            <div className="mt-4 flex flex-wrap items-end gap-4 border-t border-border pt-4">
              <Switch
                className="w-auto"
                checked={d.is_additional_charge}
                onChange={(v) => set(i, { is_additional_charge: v })}
                label="Charged on top of the package"
              />
              {d.is_additional_charge && (
                <Field label="Amount (₹)" required>
                  <Input
                    inputMode="numeric"
                    value={d.additional_charge_amount}
                    onChange={(e) => set(i, { additional_charge_amount: e.target.value })}
                    placeholder="15000"
                    className="w-40"
                  />
                </Field>
              )}
              <Switch
                className="w-auto"
                checked={d.visibility_scope === 'client'}
                onChange={(v) => set(i, { visibility_scope: v ? 'client' : 'internal' })}
                label="Visible to the client"
              />
            </div>
          </div>
        )
      })}
    </RowList>
  )
}

function BillingStep({
  draft,
  patch,
  totals,
}: {
  draft: ProjectDraft
  patch: Patch
  totals: ReturnType<typeof draftTotals>
}) {
  const set = (i: number, p: Partial<ProjectDraft['payments'][number]>) =>
    patch({ payments: draft.payments.map((x, idx) => (idx === i ? { ...x, ...p } : x)) })

  return (
    <div className="flex flex-col gap-6">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Package cost (₹)" hint="The headline price, before any chargeable extras.">
          <Input
            inputMode="numeric"
            value={draft.package_cost}
            onChange={(e) => patch({ package_cost: e.target.value })}
            placeholder="150000"
          />
        </Field>
        <div className="rounded-lg border border-border bg-muted/30 p-4 text-sm">
          <div className="flex justify-between">
            <span className="text-muted-foreground">Chargeable deliverables</span>
            <span className="tabular-nums font-medium">{formatINR(totals.addOns)}</span>
          </div>
          <div className="mt-2 flex justify-between border-t border-border pt-2">
            <span className="font-medium">Project total</span>
            <span className="tabular-nums text-base font-semibold">{formatINR(totals.total)}</span>
          </div>
        </div>
      </div>

      <div>
        <h3 className="mb-3 text-sm font-medium">Advance payments</h3>
        <RowList
          items={draft.payments}
          empty="Nothing received yet. Add an advance if the client has already paid."
          addLabel="Add payment"
          onAdd={() => patch({ payments: [...draft.payments, newPayment()] })}
        >
          {draft.payments.map((p, i) => (
            <div key={i} className="rounded-lg border border-border p-4">
              <div className="mb-3 flex items-center gap-2">
                <Wallet className="size-4 text-muted-foreground" />
                <span className="text-sm font-medium">Payment {i + 1}</span>
                <Button
                  variant="ghost"
                  size="icon"
                  className="ml-auto"
                  onClick={() => patch({ payments: draft.payments.filter((_, idx) => idx !== i) })}
                >
                  <Trash2 />
                  <span className="sr-only">Remove payment {i + 1}</span>
                </Button>
              </div>
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                <Field label="Amount (₹)" required>
                  <Input
                    inputMode="numeric"
                    value={p.amount}
                    onChange={(e) => set(i, { amount: e.target.value })}
                    placeholder="50000"
                  />
                </Field>
                <Field label="Received on">
                  <Input type="date" value={p.paid_on} onChange={(e) => set(i, { paid_on: e.target.value })} />
                </Field>
                <Field label="Mode">
                  <Select value={p.mode} onChange={(e) => set(i, { mode: e.target.value })}>
                    <option value="">—</option>
                    <option value="upi">UPI</option>
                    <option value="cash">Cash</option>
                    <option value="bank">Bank transfer</option>
                    <option value="cheque">Cheque</option>
                  </Select>
                </Field>
                <Field label="Reference">
                  <Input
                    value={p.reference}
                    onChange={(e) => set(i, { reference: e.target.value })}
                    placeholder="UTR / cheque no."
                  />
                </Field>
              </div>
            </div>
          ))}
        </RowList>
      </div>
    </div>
  )
}

function ReviewStep({
  draft,
  totals,
  errors,
  onJump,
}: {
  draft: ProjectDraft
  totals: ReturnType<typeof draftTotals>
  errors: ReturnType<typeof stepErrors>
  onJump: (s: WizardStep) => void
}) {
  const { data: clients } = useClients()
  const client = clients?.find((c) => c.id === draft.client_id)
  const problems = WIZARD_STEPS.filter((s) => errors[s])

  return (
    <div className="flex flex-col gap-5">
      {problems.length > 0 && (
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4">
          <p className="text-sm font-medium text-destructive">Fix these before creating:</p>
          <ul className="mt-2 space-y-1 text-sm">
            {problems.map((s) => (
              <li key={s}>
                <button type="button" onClick={() => onJump(s)} className="text-destructive hover:underline">
                  {STEP_LABELS[s]} — {errors[s]}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      <dl className="divide-y divide-border rounded-lg border border-border">
        <ReviewRow label="Project" value={draft.name || '—'} />
        <ReviewRow label="Client" value={client?.name ?? draft.new_client_name ?? '—'} />
        <ReviewRow label="Quotation" value={draft.show_quotation ? 'Visible to client' : 'Hidden from client'} />
        <ReviewRow label="Shoots" value={summarise(draft.shoots.map((s) => s.name || 'Untitled'))} />
        <ReviewRow label="Deliverables" value={summarise(draft.deliverables.map((d) => d.title || 'Untitled'))} />
        <ReviewRow label="Package" value={formatINR(totals.packageCost)} />
        <ReviewRow label="Chargeable extras" value={formatINR(totals.addOns)} />
        <ReviewRow label="Total" value={formatINR(totals.total)} strong />
        <ReviewRow label="Received" value={formatINR(totals.received)} />
        <ReviewRow label="Balance" value={formatINR(totals.balance)} />
      </dl>

      <p className="text-sm text-muted-foreground">
        Creating this makes {countLabel(1, 'project')}
        {draft.shoots.length ? `, ${countLabel(draft.shoots.length, 'shoot')}` : ''}
        {draft.deliverables.length ? `, ${countLabel(draft.deliverables.length, 'deliverable')}` : ''}
        {draft.payments.length ? ` and ${countLabel(draft.payments.length, 'payment')}` : ''}
        {draft.client_id ? '' : ' and a new client record'}.
      </p>
    </div>
  )
}

const countLabel = (n: number, noun: string) => `${n} ${noun}${n === 1 ? '' : 's'}`

const summarise = (names: string[]) => (names.length === 0 ? 'None' : names.join(', '))

function ReviewRow({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex gap-4 px-4 py-2.5 text-sm">
      <dt className="w-44 shrink-0 text-muted-foreground">{label}</dt>
      <dd className={cn('min-w-0 flex-1 break-words', strong ? 'font-semibold' : 'font-medium')}>{value}</dd>
    </div>
  )
}
