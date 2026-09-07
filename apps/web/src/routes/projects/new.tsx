import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import {
  AlertCircle,
  ArrowLeft,
  ArrowRight,
  Bookmark,
  CalendarDays,
  Check,
  CheckCircle2,
  Clock,
  Eye,
  MapPin,
  Package,
  Plus,
  Pencil,
  RotateCcw,
  Save,
  Search,
  SlidersHorizontal,
  Sparkles,
  Trash2,
  UserPlus,
  Users,
  Wallet,
  X,
  type LucideIcon,
} from 'lucide-react'
import {
  z,
  type CreateShootRequest,
  type ShootPreset,
  type ShootPresetKind,
  type ShootPresetPayload,
} from '@ipc/contracts'
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
import {
  useCreateProject,
  useDeleteDeliverableSet,
  useDeliverableSets,
  useSaveDeliverableSet,
} from '@/features/projects/api'
import {
  useDeleteShootPreset,
  useSaveShootPreset,
  useServices,
  useShootPresets,
} from '@/features/shoots/api'
import {
  BUILT_IN_SETS,
  EMPTY_DRAFT,
  QUICK_DELIVERABLES,
  QUICK_SHOOTS,
  SHOOT_PRESET,
  STEP_HINTS,
  STEP_LABELS,
  WIZARD_STEPS,
  canSubmit,
  clearDraft,
  deliverablesIn,
  draftTotals,
  estimatedDateFor,
  isDirty,
  internalWorkFor,
  internalWorkSuggestions,
  loadDraft,
  matchShootTypes,
  money,
  newAddOn,
  newClientDeliverable,
  newInternalWork,
  newPayment,
  newRequirement,
  newShoot,
  nextStep,
  prevStep,
  rememberLeadDays,
  removeShootAt,
  saveDraft,
  shootIssues,
  stepErrors,
  stepIndex,
  toProjectRequest,
  toShootRequests,
  withDeliverables,
  withShoots,
  type DeliverableDraft,
  type ProjectDraft,
  type ShootDraft,
  type ShootRequirementDraft,
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

      <div className="flex flex-wrap items-center gap-3 rounded-lg border border-border bg-muted/30 p-4">
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
        <CardContent className="flex flex-wrap items-start justify-between gap-3 p-4">
          <div className="min-w-0">
            <p className="text-sm font-medium">Step-by-step setup</p>
            <p className="text-xs text-muted-foreground">Complete one focused section at a time.</p>
            <Stepper
              className="mt-3"
              steps={WIZARD_STEPS.map((s) => ({ value: s, label: STEP_LABELS[s] }))}
              current={step}
              visited={visited}
              invalid={invalid}
              onJump={goTo}
            />
          </div>
          <StatusBadge tone="info">
            Step {stepIndex(step) + 1} of {WIZARD_STEPS.length}
          </StatusBadge>
        </CardContent>
      </Card>

      <div ref={sectionRef} className="mt-4 scroll-mt-4">
        <Section title={STEP_LABELS[step]} hint={STEP_HINTS[step]}>
          {step === 'client' && <ClientStep draft={draft} patch={patch} />}
          {step === 'shoots' && <ShootsStep draft={draft} patch={patch} />}
          {step === 'deliverables' && (
            <DeliverablesStep draft={draft} patch={patch} onJump={goTo} />
          )}
          {step === 'billing' && <BillingStep draft={draft} patch={patch} totals={totals} />}
          {step === 'review' && <ReviewStep draft={draft} totals={totals} errors={errors} onJump={goTo} />}

          {showErrors && stepError && <p className="mt-4 text-sm text-destructive">{stepError}</p>}
          {error && (
            <p id="form-error" role="alert" className="mt-4 text-sm text-destructive">
              {error}
            </p>
          )}
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

function Field({
  label,
  required,
  hint,
  icon: Icon,
  children,
}: {
  label: string
  required?: boolean
  hint?: string
  icon?: LucideIcon
  children: ReactNode
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label className="flex items-center gap-1.5">
        {Icon && <Icon className="size-3.5 text-muted-foreground" aria-hidden />}
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

/**
 * The full list of shoot types, searchable, behind the Add shoot button.
 *
 * Seventeen types is too many for chips and too few for the command palette,
 * so it is a menu that opens with the search box focused: type three letters
 * and press Enter, or scroll and click. Anything not on the list is typed in
 * the box and added by name, which is how a studio's odd one-off gets in
 * without anyone maintaining a list of every ceremony in the country.
 */
function AddShootMenu({
  shoots,
  onAdd,
}: {
  shoots: ShootDraft[]
  onAdd: (name: string) => void
}) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const root = useRef<HTMLDivElement>(null)
  const search = useRef<HTMLInputElement>(null)
  const list = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (open) search.current?.focus()
    else setQuery('')
  }, [open])

  useEffect(() => {
    if (!open) return
    const onDown = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('pointerdown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const taken = new Set(shoots.map((s) => s.name.trim().toLowerCase()))
  const matches = matchShootTypes(query)
  const custom = query.trim()
  const free = matches.filter((m) => !taken.has(m.toLowerCase()))

  const choose = (name: string) => {
    onAdd(name)
    setOpen(false)
  }

  /** Arrow keys walk from the box into the list and back, as a menu should. */
  function step(from: HTMLElement | null, dir: 1 | -1) {
    const items = [...(list.current?.querySelectorAll<HTMLElement>('button:not(:disabled)') ?? [])]
    if (items.length === 0) return
    const at = from ? items.indexOf(from) : -1
    const next = at === -1 ? (dir === 1 ? 0 : items.length - 1) : at + dir
    if (next < 0) search.current?.focus()
    else items[Math.min(next, items.length - 1)]?.focus()
  }

  return (
    <div ref={root} className="relative">
      <Button size="sm" onClick={() => setOpen((v) => !v)} aria-expanded={open} aria-haspopup="menu">
        <Plus /> Add shoot
      </Button>

      {open && (
        <div
          role="menu"
          aria-label="Shoot types"
          className="ipc-menu absolute left-0 top-full z-40 mt-2 w-72 max-w-[calc(100vw-3rem)] overflow-hidden rounded-lg border border-border bg-card shadow-lg"
          onKeyDown={(e) => {
            if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return
            e.preventDefault()
            step(document.activeElement as HTMLElement, e.key === 'ArrowDown' ? 1 : -1)
          }}
        >
          <div className="border-b border-border p-2">
            <div className="relative">
              <Search
                className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
                aria-hidden
              />
              <Input
                ref={search}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => {
                  // Enter takes the obvious one: the first type still free, or
                  // the words just typed if the list has nothing to offer.
                  if (e.key !== 'Enter') return
                  e.preventDefault()
                  const pick = free[0] ?? (custom || null)
                  if (pick) choose(pick)
                }}
                placeholder="Search shoot type…"
                aria-label="Search shoot type"
                className="pl-8"
              />
            </div>
          </div>

          <div ref={list} className="max-h-64 overflow-y-auto p-1.5">
            <p className="px-2 py-1 text-[0.65rem] font-semibold uppercase tracking-wider text-muted-foreground">
              Common
            </p>
            {matches.length === 0 ? (
              <p className="px-2 py-3 text-sm text-muted-foreground">
                No type matches “{custom}”. Add it below.
              </p>
            ) : (
              matches.map((name) => {
                const already = taken.has(name.toLowerCase())
                return (
                  <button
                    key={name}
                    type="button"
                    role="menuitem"
                    disabled={already}
                    onClick={() => choose(name)}
                    className={cn(
                      'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors',
                      already
                        ? 'cursor-not-allowed text-muted-foreground opacity-60'
                        : 'hover:bg-muted focus-visible:bg-muted focus-visible:outline-none',
                    )}
                  >
                    <span className="flex-1">{name}</span>
                    {already && <Check className="size-4 shrink-0" aria-hidden />}
                  </button>
                )
              })
            )}
          </div>

          <div className="border-t border-border p-2">
            <Button
              size="sm"
              className="w-full"
              onClick={() => choose(custom)}
              disabled={!!custom && taken.has(custom.toLowerCase())}
            >
              <Plus /> {custom ? `Add “${custom}”` : 'Add new shoot type'}
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}

/**
 * The busiest step in the wizard, so it opens with the shortcuts rather than a
 * blank row: a chip per common shoot day, a preset that lays down the four a
 * standard wedding books, and the whole searchable list behind Add shoot.
 */
function ShootsStep({ draft, patch }: { draft: ProjectDraft; patch: Patch }) {
  const services = useServices()
  const shootPresets = useShootPresets('shoot')

  const set = (i: number, p: Partial<ShootDraft>) =>
    patch({ shoots: draft.shoots.map((s, idx) => (idx === i ? { ...s, ...p } : s)) })

  const add = (names: readonly string[]) => patch({ shoots: withShoots(draft.shoots, names) })
  // An empty name is the "add new shoot type" case with nothing typed yet: a
  // blank row to fill in, which withShoots would otherwise drop.
  const addNamed = (name: string) =>
    patch({ shoots: name ? withShoots(draft.shoots, [name]) : [...draft.shoots, newShoot()] })
  const wedding = withShoots(draft.shoots, SHOOT_PRESET)

  /** A saved day, stamped out whole: its crew and its edit-room list with it. */
  const applyShootPreset = (preset: ShootPreset) => {
    const at = draft.shoots.length
    patch({
      shoots: [
        ...draft.shoots,
        {
          ...newShoot(),
          name: preset.name,
          requirements: preset.payload.requirements.map((r) => ({
            name: r.name,
            quantity: String(r.quantity),
          })),
        },
      ],
      deliverables: [
        ...draft.deliverables,
        ...preset.payload.internal_work.map((title) => newInternalWork(at, title)),
      ],
    })
  }

  return (
    <div className="flex flex-col gap-4">
      {/* One list for every requirement input on the step: the browser reads
          it by id, and rendering it per row would repeat it a dozen times. */}
      <datalist id={SERVICE_LIST_ID}>
        {(services.data ?? []).map((s) => (
          <option key={s.id} value={s.name} />
        ))}
      </datalist>

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-sm font-medium">Shoot schedule</p>
          <p className="text-xs text-muted-foreground">
            Add every shoot day. Pick a common one below, or add a custom shoot.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <AddShootMenu shoots={draft.shoots} onAdd={addNamed} />
          <PresetMenu
            label="Apply preset"
            presets={shootPresets.data ?? []}
            onApply={applyShootPreset}
            builtIn={{
              label: `Standard wedding — ${SHOOT_PRESET.join(', ')}`,
              disabled: wedding.length === draft.shoots.length,
              onApply: () => patch({ shoots: wedding }),
            }}
          />
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
          Quick add
        </span>
        {QUICK_SHOOTS.map((name) => {
          const already = draft.shoots.some(
            (s) => s.name.trim().toLowerCase() === name.toLowerCase(),
          )
          return (
            <button
              key={name}
              type="button"
              onClick={() => add([name])}
              disabled={already}
              title={already ? `${name} is already on the schedule` : undefined}
              className={cn(
                'flex items-center gap-1 rounded-full border border-border px-3 py-1 text-sm font-medium transition-colors',
                already
                  ? 'cursor-not-allowed text-muted-foreground opacity-60'
                  : 'hover:border-primary hover:bg-primary/10 hover:text-primary',
              )}
            >
              {already ? <Check className="size-3.5" aria-hidden /> : <Plus className="size-3.5" aria-hidden />}
              {name}
            </button>
          )
        })}
      </div>

      {draft.shoots.length === 0 ? (
        <div className="flex flex-col items-center gap-1 rounded-lg border border-dashed border-border px-6 py-10 text-center">
          <CalendarDays className="size-5 text-muted-foreground" aria-hidden />
          <p className="mt-1 font-medium">No shoots yet</p>
          <p className="text-sm text-muted-foreground">
            Add Haldi, Wedding Day, Reception and the rest with the buttons above. Deliverable
            dates count forward from these.
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {draft.shoots.map((s, i) => (
            <ShootCard
              key={i}
              index={i}
              shoot={s}
              draft={draft}
              patch={patch}
              onChange={(p) => set(i, p)}
              onRemove={() => patch(removeShootAt(draft, i))}
            />
          ))}
        </div>
      )}
    </div>
  )
}

/** Shared by every requirement input on the step. */
const SERVICE_LIST_ID = 'ipc-shoot-services'

/**
 * One shoot day, whole: when it is, where it is, who it needs, and what the
 * edit room owes off the back of it.
 *
 * The card tints when something is missing rather than blocking — a studio
 * booking a date off a phone call has the day before it has the crew, and the
 * wizard should take the booking either way. Only a missing title actually
 * stops the step.
 */
function ShootCard({
  index,
  shoot,
  draft,
  patch,
  onChange,
  onRemove,
}: {
  index: number
  shoot: ShootDraft
  draft: ProjectDraft
  patch: Patch
  onChange: (p: Partial<ShootDraft>) => void
  onRemove: () => void
}) {
  const issues = shootIssues(shoot)
  const work = internalWorkFor(draft, index)

  const setRequirement = (at: number, p: Partial<ShootRequirementDraft>) =>
    onChange({ requirements: shoot.requirements.map((r, i) => (i === at ? { ...r, ...p } : r)) })

  return (
    <div
      className={cn(
        'rounded-lg border p-4',
        issues.length ? 'border-destructive/25 bg-destructive/5' : 'border-border',
      )}
    >
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary">
          {index + 1}
        </span>
        <span className="font-medium">{shoot.name.trim() || `Shoot ${index + 1}`}</span>
        {issues.map((issue) => (
          <StatusBadge key={issue} tone={issue === 'No requirements' ? 'warning' : 'danger'}>
            <AlertCircle className="mr-1 size-3" aria-hidden />
            {issue}
          </StatusBadge>
        ))}
        <div className="ml-auto flex items-center gap-1">
          <SavePresetButton
            kind="shoot"
            defaultName={shoot.name.trim() || `Shoot ${index + 1}`}
            label="Save as preset"
            payload={{
              requirements: shoot.requirements
                .filter((r) => r.name.trim())
                .map((r) => ({ name: r.name.trim(), quantity: Math.max(1, Number(r.quantity) || 1) })),
              internal_work: work.map((w) => w.item.title.trim()).filter(Boolean),
            }}
          />
          <Button variant="ghost" size="icon" onClick={onRemove}>
            <Trash2 className="text-destructive" />
            <span className="sr-only">Remove shoot {index + 1}</span>
          </Button>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Field label="Shoot title" required>
          <Input
            value={shoot.name}
            onChange={(e) => onChange({ name: e.target.value })}
            placeholder="Wedding day"
          />
        </Field>
        <Field label="Date" icon={CalendarDays}>
          <Input
            type="date"
            value={shoot.shoot_date}
            onChange={(e) => onChange({ shoot_date: e.target.value })}
          />
        </Field>
        <Field label="Time" icon={Clock}>
          <Input
            type="time"
            value={shoot.start_time}
            onChange={(e) => onChange({ start_time: e.target.value })}
          />
        </Field>
        <Field label="City / Venue" icon={MapPin}>
          <Input
            value={shoot.location}
            onChange={(e) => onChange({ location: e.target.value })}
            placeholder="e.g. Jaipur"
          />
        </Field>
      </div>

      <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="lg:col-span-3">
          <Field
            label="Google Map link"
            icon={MapPin}
            hint="Optional. Paste a Google Maps link only — the address text belongs in City / Venue."
          >
            <Input
              type="url"
              inputMode="url"
              value={shoot.map_link}
              onChange={(e) => onChange({ map_link: e.target.value })}
              placeholder="Paste Google Maps link"
            />
          </Field>
        </div>
        <Field label="Status">
          <Select
            value={shoot.status}
            onChange={(e) => onChange({ status: e.target.value as ShootDraft['status'] })}
          >
            <option value="planned">Planned</option>
            <option value="confirmed">Confirmed</option>
          </Select>
        </Field>
      </div>

      {/* ── who this day needs ── */}
      <SubCard
        icon={Users}
        title="Shoot requirements"
        hint="Pick people or services and set how many of each this day needs."
        actions={
          <Button
            size="sm"
            onClick={() => onChange({ requirements: [...shoot.requirements, newRequirement()] })}
          >
            <SlidersHorizontal /> Add requirements
          </Button>
        }
      >
        {shoot.requirements.length === 0 ? (
          <Band tone="warning">No requirements yet — tap “Add requirements” to plan the team.</Band>
        ) : (
          <div className="flex flex-col gap-2">
            {shoot.requirements.map((r, at) => (
              <div key={at} className="flex items-center gap-2">
                <Input
                  list={SERVICE_LIST_ID}
                  value={r.name}
                  onChange={(e) => setRequirement(at, { name: e.target.value })}
                  placeholder="Photographer"
                  aria-label={`Requirement ${at + 1}`}
                  className="flex-1"
                />
                <Input
                  type="number"
                  min={1}
                  max={99}
                  value={r.quantity}
                  onChange={(e) => setRequirement(at, { quantity: e.target.value })}
                  aria-label={`How many for requirement ${at + 1}`}
                  className="w-20"
                />
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() =>
                    onChange({ requirements: shoot.requirements.filter((_, i) => i !== at) })
                  }
                >
                  <Trash2 />
                  <span className="sr-only">Remove requirement {at + 1}</span>
                </Button>
              </div>
            ))}
          </div>
        )}
      </SubCard>

      {/* ── what the edit room owes off it ── */}
      <InternalWorkBlock index={index} shoot={shoot} draft={draft} patch={patch} work={work} />
    </div>
  )
}

/**
 * The team's own list for one shoot — culling, sorting, the reel — kept off
 * the quotation because a client is not buying "data sorting", they are
 * buying the album it feeds. Same deliverables array as step 3; this is the
 * per-shoot window onto it.
 */
function InternalWorkBlock({
  index,
  shoot,
  draft,
  patch,
  work,
}: {
  index: number
  shoot: ShootDraft
  draft: ProjectDraft
  patch: Patch
  work: { at: number; item: DeliverableDraft }[]
}) {
  const titles = new Set(work.map((w) => w.item.title.trim().toLowerCase()))
  const suggestions = internalWorkSuggestions(shoot.name).filter(
    (s) => !titles.has(s.toLowerCase()),
  )
  const presets = useShootPresets('internal_work')

  const addTitles = (names: string[]) =>
    patch({
      deliverables: [
        ...draft.deliverables,
        ...names
          .filter((n) => !n.trim() || !titles.has(n.trim().toLowerCase()))
          .map((n) => newInternalWork(index, n.trim())),
      ],
    })

  const setTitle = (at: number, title: string) =>
    patch({
      deliverables: draft.deliverables.map((d, i) => (i === at ? { ...d, title } : d)),
    })

  return (
    <SubCard
      icon={Package}
      title="Internal work for this shoot"
      hint="These items help the team edit, sort, hand off and track. They never appear on the quotation."
      actions={
        <>
          <PresetMenu
            label="Apply preset"
            variant="ghost"
            presets={presets.data ?? []}
            onApply={(p) => addTitles([...p.payload.internal_work])}
          />
          <SavePresetButton
            kind="internal_work"
            defaultName={shoot.name.trim() ? `${shoot.name.trim()} edit room` : 'Edit room'}
            label="Save preset"
            payload={{
              requirements: [],
              internal_work: work.map((w) => w.item.title.trim()).filter(Boolean),
            }}
          />
          <Button size="sm" onClick={() => addTitles([''])}>
            <Plus /> Add more deliverables
          </Button>
        </>
      }
    >
      {work.length === 0 ? (
        <Band>No deliverables added for this shoot yet.</Band>
      ) : (
        <div className="flex flex-col gap-2">
          {work.map(({ at, item }) => (
            <div key={at} className="flex items-center gap-2">
              <Input
                value={item.title}
                onChange={(e) => setTitle(at, e.target.value)}
                placeholder="Edited photos"
                aria-label={`Internal work ${at + 1}`}
                className="flex-1"
              />
              <Button
                variant="ghost"
                size="icon"
                onClick={() =>
                  patch({ deliverables: draft.deliverables.filter((_, i) => i !== at) })
                }
              >
                <Trash2 />
                <span className="sr-only">Remove internal work {at + 1}</span>
              </Button>
            </div>
          ))}
        </div>
      )}

      {suggestions.length > 0 && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <span className="flex items-center gap-1 text-xs text-muted-foreground">
            <Sparkles className="size-3.5" aria-hidden />
            Suggested for {shoot.name.trim() || 'this shoot'}
          </span>
          {suggestions.map((title) => (
            <button
              key={title}
              type="button"
              onClick={() => addTitles([title])}
              className="flex items-center gap-1 rounded-full border border-border px-3 py-1 text-sm font-medium transition-colors hover:border-primary hover:bg-primary/10 hover:text-primary"
            >
              <Plus className="size-3.5" aria-hidden />
              {title}
            </button>
          ))}
        </div>
      )}
    </SubCard>
  )
}

/** A titled block inside a shoot card: heading, hint, buttons, body. */
function SubCard({
  icon: Icon,
  title,
  hint,
  actions,
  children,
}: {
  icon: LucideIcon
  title: string
  hint: string
  actions: ReactNode
  children: ReactNode
}) {
  return (
    <div className="mt-4 rounded-lg border border-border bg-card p-3">
      <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="flex items-center gap-2 text-sm font-medium">
            <Icon className="size-4 text-muted-foreground" aria-hidden />
            {title}
          </p>
          <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">{actions}</div>
      </div>
      {children}
    </div>
  )
}

/** The dashed "nothing here yet" strip inside a sub-card. */
function Band({ tone, children }: { tone?: 'warning'; children: ReactNode }) {
  return (
    <p
      className={cn(
        'rounded-md border border-dashed px-3 py-4 text-center text-sm',
        tone === 'warning'
          ? 'border-warning/40 bg-warning/10 text-warning'
          : 'border-border text-muted-foreground',
      )}
    >
      {children}
    </p>
  )
}

/**
 * Saved shapes, listed. The built-in wedding preset rides in the same menu as
 * the studio's own, because from the pressing end they are the same thing.
 */
function PresetMenu({
  label,
  presets,
  onApply,
  builtIn,
  variant = 'outline',
}: {
  label: string
  presets: ShootPreset[]
  onApply: (preset: ShootPreset) => void
  builtIn?: { label: string; disabled: boolean; onApply: () => void }
  variant?: 'outline' | 'ghost'
}) {
  const [open, setOpen] = useState(false)
  const root = useRef<HTMLDivElement>(null)
  const remove = useDeleteShootPreset()

  useEffect(() => {
    if (!open) return
    const onDown = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('pointerdown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  return (
    <div ref={root} className="relative">
      <Button size="sm" variant={variant} onClick={() => setOpen((v) => !v)} aria-expanded={open}>
        <Sparkles /> {label}
      </Button>
      {open && (
        <div
          role="menu"
          aria-label={label}
          className="ipc-menu absolute right-0 top-full z-40 mt-2 w-72 max-w-[calc(100vw-3rem)] overflow-hidden rounded-lg border border-border bg-card p-1.5 shadow-lg"
        >
          {builtIn && (
            <button
              type="button"
              role="menuitem"
              disabled={builtIn.disabled}
              onClick={() => {
                builtIn.onApply()
                setOpen(false)
              }}
              className={cn(
                'w-full rounded-md px-2 py-1.5 text-left text-sm transition-colors',
                builtIn.disabled
                  ? 'cursor-not-allowed text-muted-foreground opacity-60'
                  : 'hover:bg-muted',
              )}
            >
              {builtIn.label}
            </button>
          )}
          {presets.length === 0 ? (
            <p className="px-2 py-3 text-sm text-muted-foreground">
              No saved presets yet. Set a shoot up the way you like it, then save it.
            </p>
          ) : (
            presets.map((p) => (
              <div key={p.id} className="flex items-center gap-1">
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    onApply(p)
                    setOpen(false)
                  }}
                  className="flex-1 rounded-md px-2 py-1.5 text-left text-sm transition-colors hover:bg-muted"
                >
                  {p.name}
                </button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-7"
                  onClick={() => remove.mutate(p.id)}
                  disabled={remove.isPending}
                >
                  <Trash2 />
                  <span className="sr-only">Delete preset {p.name}</span>
                </Button>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  )
}

/**
 * Save this shape under a name. The name field opens in place rather than in a
 * dialog: it is one short answer, and a modal over a wizard step is a lot of
 * ceremony for a text box.
 */
function SavePresetButton({
  kind,
  defaultName,
  label,
  payload,
}: {
  kind: ShootPresetKind
  defaultName: string
  label: string
  payload: ShootPresetPayload
}) {
  const [open, setOpen] = useState(false)
  const [name, setName] = useState(defaultName)
  const save = useSaveShootPreset()
  const empty = payload.requirements.length === 0 && payload.internal_work.length === 0

  const submit = () => {
    if (!name.trim()) return
    save.mutate({ kind, name: name.trim(), payload }, { onSuccess: () => setOpen(false) })
  }

  return (
    <div className="relative">
      <Button
        size="sm"
        variant="ghost"
        onClick={() => {
          setName(defaultName)
          setOpen((v) => !v)
        }}
        disabled={empty}
        title={empty ? 'Nothing to save yet' : undefined}
      >
        <Bookmark /> {label}
      </Button>
      {open && (
        <div className="ipc-menu absolute right-0 top-full z-40 mt-2 flex w-64 items-center gap-2 rounded-lg border border-border bg-card p-2 shadow-lg">
          <Input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') submit()
              if (e.key === 'Escape') setOpen(false)
            }}
            aria-label="Preset name"
            placeholder="Preset name"
          />
          <Button size="sm" onClick={submit} disabled={!name.trim() || save.isPending}>
            Save
          </Button>
        </div>
      )}
    </div>
  )
}
/**
 * What the client is promised, what costs extra, and what only the team sees —
 * three lists rather than one, because those are three different conversations
 * and only the first two ever reach a quotation.
 *
 * A row's list is not a stored field: it falls out of the two switches the row
 * already carries, so turning "Charged on top" on moves an item into add-ons
 * with no second source of truth to disagree.
 */
function DeliverablesStep({
  draft,
  patch,
  onJump,
}: {
  draft: ProjectDraft
  patch: Patch
  onJump: (step: WizardStep) => void
}) {
  const sets = useDeliverableSets()
  const saveSet = useSaveDeliverableSet()
  const deleteSet = useDeleteDeliverableSet()
  const [naming, setNaming] = useState(false)
  const [setName, setSetName] = useState('')

  const client = deliverablesIn(draft, 'client')
  const addOns = deliverablesIn(draft, 'add_on')
  const internal = deliverablesIn(draft, 'internal')

  const add = (items: { title: string }[]) =>
    patch({ deliverables: withDeliverables(draft.deliverables, items) })

  const saveable = [...client, ...addOns].map(({ item }) => ({
    title: item.title.trim(),
    is_additional_charge: item.is_additional_charge,
    additional_charge_amount: money(item.additional_charge_amount),
    show_on_quotation: item.show_on_quotation,
  })).filter((i) => i.title)

  return (
    <div className="flex flex-col gap-5">
      {/* ── what the client is promised ── */}
      <SubCard
        icon={Package}
        title="Client deliverables"
        hint="The final items promised to the client, shown on the quotation when enabled."
        actions={
          <Button
            size="sm"
            variant="outline"
            onClick={() => patch({ deliverables: [...draft.deliverables, newClientDeliverable()] })}
          >
            <Plus /> Add row
          </Button>
        }
      >
        <p className="mb-3 flex items-start gap-2 rounded-md bg-primary/10 px-3 py-2 text-sm font-medium text-primary">
          <Eye className="mt-0.5 size-4 shrink-0" aria-hidden />
          Only items with “Show on quotation” on will appear in the client quotation.
        </p>

        <div className="mb-3 rounded-lg border border-border bg-muted/30 p-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
              Load set
            </span>
            {BUILT_IN_SETS.map((s) => (
              <button
                key={s.name}
                type="button"
                onClick={() => add(s.titles.map((title) => ({ title })))}
                title={s.titles.join(', ')}
                className="flex items-center gap-1 rounded-full border border-border bg-card px-3 py-1 text-sm font-medium transition-colors hover:border-primary hover:bg-primary/10 hover:text-primary"
              >
                <Plus className="size-3.5" aria-hidden />
                {s.name}
              </button>
            ))}
            {(sets.data ?? []).map((s) => (
              <span
                key={s.id}
                className="flex items-center rounded-full border border-border bg-card pr-1 text-sm font-medium"
              >
                <button
                  type="button"
                  onClick={() => patch({ deliverables: withDeliverables(draft.deliverables, s.items) })}
                  title={s.items.map((i) => i.title).join(', ')}
                  className="flex items-center gap-1 rounded-full px-3 py-1 transition-colors hover:text-primary"
                >
                  <Plus className="size-3.5" aria-hidden />
                  {s.name}
                </button>
                <button
                  type="button"
                  onClick={() => deleteSet.mutate(s.id)}
                  disabled={deleteSet.isPending}
                  className="rounded-full p-1 text-muted-foreground transition-colors hover:text-destructive"
                >
                  <X className="size-3.5" aria-hidden />
                  <span className="sr-only">Delete set {s.name}</span>
                </button>
              </span>
            ))}
          </div>

          <div className="mt-2 flex flex-wrap items-center gap-2">
            {naming ? (
              <>
                <Input
                  autoFocus
                  value={setName}
                  onChange={(e) => setSetName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Escape') setNaming(false)
                    if (e.key !== 'Enter' || !setName.trim()) return
                    saveSet.mutate(
                      { name: setName.trim(), items: saveable },
                      { onSuccess: () => setNaming(false) },
                    )
                  }}
                  placeholder="Name this set"
                  aria-label="Set name"
                  className="w-56"
                />
                <Button
                  size="sm"
                  onClick={() =>
                    saveSet.mutate(
                      { name: setName.trim(), items: saveable },
                      { onSuccess: () => setNaming(false) },
                    )
                  }
                  disabled={!setName.trim() || saveSet.isPending}
                >
                  Save
                </Button>
              </>
            ) : (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  setSetName('')
                  setNaming(true)
                }}
                disabled={saveable.length === 0}
                title={saveable.length === 0 ? 'Add a deliverable first' : undefined}
              >
                <Save /> Save as set
              </Button>
            )}
            <span className="text-xs text-muted-foreground">
              Sets are shared with your whole team. Delivery-time memory stays on this device.
            </span>
          </div>
        </div>

        <div className="mb-3 flex flex-wrap items-center gap-2">
          <span className="flex items-center gap-1 text-xs font-medium uppercase tracking-wider text-muted-foreground">
            <Sparkles className="size-3.5" aria-hidden />
            Quick add
          </span>
          {QUICK_DELIVERABLES.map((title) => {
            const already = draft.deliverables.some(
              (d) => d.title.trim().toLowerCase() === title.toLowerCase(),
            )
            return (
              <button
                key={title}
                type="button"
                onClick={() => add([{ title }])}
                disabled={already}
                title={already ? `${title} is already on the list` : undefined}
                className={cn(
                  'flex items-center gap-1 rounded-full border border-border px-3 py-1 text-sm font-medium transition-colors',
                  already
                    ? 'cursor-not-allowed text-muted-foreground opacity-60'
                    : 'hover:border-primary hover:bg-primary/10 hover:text-primary',
                )}
              >
                {already ? <Check className="size-3.5" aria-hidden /> : <Plus className="size-3.5" aria-hidden />}
                {title}
              </button>
            )
          })}
        </div>

        {client.length === 0 ? (
          <Band>
            No deliverables yet. Tap a Quick add chip above, or load one of your sets.
          </Band>
        ) : (
          <div className="flex flex-col gap-3">
            {client.map(({ at, item }) => (
              <DeliverableRow key={at} at={at} item={item} draft={draft} patch={patch} />
            ))}
          </div>
        )}
      </SubCard>

      {/* ── what costs extra ── */}
      <SubCard
        icon={Wallet}
        title="Additional client services"
        hint="Optional add-ons billed on top of the package. Turn off “Show on quotation” to keep one internal."
        actions={
          <Button
            size="sm"
            variant="outline"
            onClick={() => patch({ deliverables: [...draft.deliverables, newAddOn()] })}
          >
            <Plus /> Add row
          </Button>
        }
      >
        {addOns.length === 0 ? (
          <Band>Nothing billed separately yet. Use “Add row” to add an extra.</Band>
        ) : (
          <div className="flex flex-col gap-3">
            {addOns.map(({ at, item }) => (
              <DeliverableRow key={at} at={at} item={item} draft={draft} patch={patch} />
            ))}
          </div>
        )}
      </SubCard>

      {/* ── what only the team sees ── */}
      {internal.length > 0 && (
        <SubCard
          icon={Users}
          title="Internal work"
          hint="For your team only — never shown on the quotation. Items added inside a shoot are edited there."
          actions={
            internal.some(({ item }) => item.shoot_index !== null) ? (
              <Button size="sm" variant="ghost" onClick={() => onJump('shoots')}>
                <Pencil /> Edit in Shoots
              </Button>
            ) : null
          }
        >
          <div className="flex flex-col gap-2">
            {internal.map(({ at, item }) =>
              item.shoot_index === null ? (
                <DeliverableRow key={at} at={at} item={item} draft={draft} patch={patch} />
              ) : (
                <div
                  key={at}
                  className="flex items-center gap-2 rounded-md border border-border px-3 py-2 text-sm"
                >
                  <Package className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                  <span className="font-medium">{item.title || 'Untitled'}</span>
                  <span className="text-muted-foreground">
                    · {draft.shoots[item.shoot_index]?.name?.trim() || `Shoot ${item.shoot_index + 1}`}
                  </span>
                </div>
              ),
            )}
          </div>
        </SubCard>
      )}
    </div>
  )
}

/**
 * One deliverable, edited in place.
 *
 * The lead time is remembered per title on this device as it is typed, so the
 * next project that quotes a "Photo Album" starts from the turnaround this
 * studio actually works to instead of an empty box.
 */
function DeliverableRow({
  at,
  item,
  draft,
  patch,
}: {
  at: number
  item: DeliverableDraft
  draft: ProjectDraft
  patch: Patch
}) {
  const set = (p: Partial<DeliverableDraft>) =>
    patch({ deliverables: draft.deliverables.map((d, i) => (i === at ? { ...d, ...p } : d)) })
  const due = estimatedDateFor(draft, item)

  return (
    <div className="rounded-lg border border-border p-4">
      <div className="mb-3 flex items-center gap-2">
        <Package className="size-4 text-muted-foreground" />
        <span className="text-sm font-medium">{item.title.trim() || 'Untitled deliverable'}</span>
        <Button
          variant="ghost"
          size="icon"
          className="ml-auto"
          onClick={() => patch({ deliverables: draft.deliverables.filter((_, i) => i !== at) })}
        >
          <Trash2 />
          <span className="sr-only">Remove {item.title.trim() || 'this deliverable'}</span>
        </Button>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Title" required>
          <Input
            value={item.title}
            onChange={(e) => set({ title: e.target.value })}
            placeholder="Wedding album"
          />
        </Field>
        <Field label="Starts after">
          <Select
            value={item.start_rule}
            onChange={(e) => set({ start_rule: e.target.value as DeliverableDraft['start_rule'] })}
          >
            <option value="whole_project">All shoots are done</option>
            <option value="this_shoot">One specific shoot</option>
            <option value="specific_shoots">Selected shoots</option>
            <option value="no_data">No schedule</option>
          </Select>
        </Field>

        {item.start_rule === 'this_shoot' && (
          <Field label="Which shoot">
            <Select
              value={item.shoot_index ?? ''}
              onChange={(e) => set({ shoot_index: e.target.value === '' ? null : Number(e.target.value) })}
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

        {item.start_rule !== 'no_data' && (
          <Field label="Delivery lead time (days)">
            <Input
              inputMode="numeric"
              value={item.lead_days}
              onChange={(e) => set({ lead_days: e.target.value })}
              onBlur={(e) => rememberLeadDays(item.title, e.target.value)}
              placeholder="45"
            />
          </Field>
        )}
      </div>

      {item.start_rule !== 'no_data' && (
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
          checked={item.is_additional_charge}
          onChange={(v) => set({ is_additional_charge: v })}
          label="Charged on top of the package"
        />
        {item.is_additional_charge && (
          <Field label="Amount (₹)" required>
            <Input
              inputMode="numeric"
              value={item.additional_charge_amount}
              onChange={(e) => set({ additional_charge_amount: e.target.value })}
              placeholder="15000"
              className="w-40"
            />
          </Field>
        )}
        <Switch
          className="w-auto"
          checked={item.show_on_quotation}
          onChange={(v) => set({ show_on_quotation: v })}
          label="Show on quotation"
        />
        <Switch
          className="w-auto"
          checked={item.visibility_scope === 'client'}
          onChange={(v) => set({ visibility_scope: v ? 'client' : 'internal' })}
          label="Visible to the client"
        />
      </div>
    </div>
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

/**
 * The last look before the project exists.
 *
 * Six tiles rather than a table of twenty rows: what a studio checks here is
 * "is this the right client, the right days, the right money", and each tile
 * carries the Edit that takes them back to fix it. A tile whose step still has
 * a problem says what the problem is, in place — so nobody has to open a step
 * to find out why the button won't fire.
 */
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
  const clientName = client?.name ?? draft.new_client_name.trim()
  const problems = WIZARD_STEPS.filter((s) => errors[s])

  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <ReviewTile
          label="Project"
          value={draft.name.trim() || '—'}
          problem={errors.client && !draft.name.trim() ? errors.client : undefined}
          onEdit={() => onJump('client')}
        />
        <ReviewTile
          label="Client"
          value={clientName || 'Not set'}
          problem={errors.client && !clientName ? errors.client : undefined}
          onEdit={() => onJump('client')}
        />
        <ReviewTile
          label="Shoots"
          value={
            draft.shoots.length ? `${countLabel(draft.shoots.length, 'shoot')} added` : 'None added'
          }
          hint={summarise(draft.shoots.map((s) => s.name.trim() || 'Untitled'))}
          problem={errors.shoots}
          onEdit={() => onJump('shoots')}
        />
        <ReviewTile
          label="Deliverables"
          value={
            draft.deliverables.length
              ? `${countLabel(draft.deliverables.length, 'deliverable')} added`
              : 'None added'
          }
          hint={summarise(draft.deliverables.map((d) => d.title.trim() || 'Untitled'))}
          problem={errors.deliverables}
          onEdit={() => onJump('deliverables')}
        />
        <ReviewTile
          label="Package / add-ons / total"
          value={`${formatINR(totals.packageCost)} + ${formatINR(totals.addOns)} = ${formatINR(totals.total)}`}
          accent
          onEdit={() => onJump('billing')}
        />
        <ReviewTile
          label="Payments"
          value={`Received ${formatINR(totals.received)} · Pending ${formatINR(totals.balance)}`}
          problem={errors.billing}
          onEdit={() => onJump('billing')}
        />
      </div>

      {problems.length > 0 ? (
        <p className="text-sm font-medium text-warning">
          Some required fields are missing. Use Edit to fix them before creating the project.
        </p>
      ) : (
        <p className="text-sm text-muted-foreground">
          Creating this makes {countLabel(1, 'project')}
          {draft.shoots.length ? `, ${countLabel(draft.shoots.length, 'shoot')}` : ''}
          {draft.deliverables.length ? `, ${countLabel(draft.deliverables.length, 'deliverable')}` : ''}
          {draft.payments.length ? ` and ${countLabel(draft.payments.length, 'payment')}` : ''}
          {draft.client_id ? '' : ' and a new client record'}.
        </p>
      )}
    </div>
  )
}

/** One fact about the project, and the way back to change it. */
function ReviewTile({
  label,
  value,
  hint,
  problem,
  accent,
  onEdit,
}: {
  label: string
  value: string
  hint?: string
  problem?: string | undefined
  accent?: boolean
  onEdit: () => void
}) {
  return (
    <div
      className={cn(
        'flex items-start gap-3 rounded-lg border p-4',
        problem
          ? 'border-destructive/30 bg-destructive/5'
          : accent
            ? 'border-primary/30 bg-primary/5'
            : 'border-border bg-muted/30',
      )}
    >
      <div className="min-w-0 flex-1">
        <p className="text-[0.7rem] font-semibold uppercase tracking-wider text-muted-foreground">
          {label}
        </p>
        <p className={cn('break-words font-semibold', accent && 'text-primary')}>
          {value}
        </p>
        {problem ? (
          <p className="mt-1 text-xs text-destructive">{problem}</p>
        ) : (
          hint && <p className="truncate text-xs text-muted-foreground">{hint}</p>
        )}
      </div>
      <Button variant="ghost" size="sm" onClick={onEdit}>
        <Pencil /> Edit
      </Button>
    </div>
  )
}

const countLabel = (n: number, noun: string) => `${n} ${noun}${n === 1 ? '' : 's'}`

const summarise = (names: string[]) => (names.length === 0 ? 'None' : names.join(', '))
