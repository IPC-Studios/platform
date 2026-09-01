import { useRef, useState, type ReactNode } from 'react'
import { Check } from 'lucide-react'
import { Button } from '@/shared/ui/button'
import { Card, CardContent } from '@/shared/ui/card'
import { cn } from '@/shared/ui/cn'
import { Input, Label, Select } from '@/shared/ui/input'
import { formatINR, humanize } from '@/shared/ui/format'
import type { FieldErrors } from '@/shared/forms/field-errors'
import { scrollIntoView } from '@/shared/ui/motion'
import { useAddMember, useEmployeeRoles } from './api'
import {
  EMPTY_DRAFT,
  STEP_LABELS,
  WIZARD_STEPS,
  isStepValid,
  nextStep,
  prevStep,
  stepErrors,
  stepIndex,
  toRequest,
  type MemberDraft,
  type WizardStep,
} from './wizard'

/**
 * Add Team Member — six questions, one screen at a time.
 *
 * The wizard takes over the page rather than opening a dialog: it collects
 * enough (identity, credentials, pay) that a modal would either scroll or
 * squeeze, and the owner should be able to stop halfway without losing the tab
 * they were on.
 */
export function AddMemberWizard({ onDone, onCancel }: { onDone: () => void; onCancel: () => void }) {
  const [step, setStep] = useState<WizardStep>('engagement')
  const [draft, setDraft] = useState<MemberDraft>(EMPTY_DRAFT)
  const [showErrors, setShowErrors] = useState(false)
  const cardRef = useRef<HTMLDivElement>(null)
  const add = useAddMember()

  const goToStep = (next: WizardStep) => {
    setStep(next)
    scrollIntoView(cardRef.current)
  }

  const set = <K extends keyof MemberDraft>(key: K, value: MemberDraft[K]) => {
    setDraft((d) => ({ ...d, [key]: value }))
    setShowErrors(false)
  }

  const errors = stepErrors(step, draft)
  const shown: FieldErrors<keyof MemberDraft> = showErrors ? errors : {}
  const index = stepIndex(step)
  const isLast = step === 'review'

  function onContinue() {
    if (!isStepValid(step, draft)) {
      setShowErrors(true)
      return
    }
    setShowErrors(false)
    if (!isLast) {
      goToStep(nextStep(step))
      return
    }
    add.mutate(toRequest(draft), { onSuccess: onDone })
  }

  return (
    <div className="mx-auto w-full max-w-2xl">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-xl font-semibold tracking-tight">Add Team Member</h2>
          <p className="mt-0.5 text-sm text-muted-foreground">
            Step {index + 1} of {WIZARD_STEPS.length} — {STEP_LABELS[step]}
          </p>
        </div>
        <Button variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
      </div>

      <Progress index={index} />
      <StepChips current={step} onJump={goToStep} />

      <Card ref={cardRef} className="mt-6 scroll-mt-4">
        <CardContent className="p-6">
          {step === 'engagement' && <EngagementStep draft={draft} set={set} />}
          {step === 'login' && <LoginStep draft={draft} set={set} />}
          {step === 'contact' && <ContactStep draft={draft} set={set} errors={shown} />}
          {step === 'role' && <RoleStep draft={draft} set={set} />}
          {step === 'details' && <DetailsStep draft={draft} set={set} errors={shown} />}
          {step === 'review' && <ReviewStep draft={draft} errors={shown} />}

          <div className="mt-8 flex items-center justify-between">
            <Button
              variant="outline"
              onClick={() => goToStep(prevStep(step))}
              disabled={index === 0 || add.isPending}
            >
              Back
            </Button>
            <Button onClick={onContinue} disabled={add.isPending}>
              {isLast ? (add.isPending ? 'Adding…' : 'Add team member') : 'Continue'}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

function Progress({ index }: { index: number }) {
  const pct = ((index + 1) / WIZARD_STEPS.length) * 100
  return (
    <div
      className="mt-4 h-1.5 w-full overflow-hidden rounded-full bg-muted"
      role="progressbar"
      aria-valuenow={index + 1}
      aria-valuemin={1}
      aria-valuemax={WIZARD_STEPS.length}
      aria-label="Add team member progress"
    >
      <div className="h-full rounded-full bg-primary transition-[width] duration-300" style={{ width: `${pct}%` }} />
    </div>
  )
}

/** Steps already answered stay clickable — going back to fix one is normal. */
function StepChips({ current, onJump }: { current: WizardStep; onJump: (s: WizardStep) => void }) {
  const currentIndex = stepIndex(current)
  return (
    <ol className="mt-4 flex flex-wrap items-center gap-x-6 gap-y-2">
      {WIZARD_STEPS.map((s, i) => {
        const done = i < currentIndex
        const active = i === currentIndex
        return (
          <li key={s}>
            <button
              type="button"
              onClick={() => done && onJump(s)}
              disabled={!done}
              className={cn(
                'flex items-center gap-2 text-sm',
                active ? 'font-semibold text-foreground' : 'text-muted-foreground',
                done && 'hover:text-foreground',
              )}
            >
              <span
                className={cn(
                  'flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold',
                  done && 'bg-primary text-primary-foreground',
                  active && 'bg-primary/10 text-primary ring-1 ring-primary/40',
                  !done && !active && 'bg-muted text-muted-foreground',
                )}
              >
                {done ? <Check className="size-3.5" /> : i + 1}
              </span>
              {STEP_LABELS[s]}
            </button>
          </li>
        )
      })}
    </ol>
  )
}

function StepHeader({ title, description }: { title: string; description: string }) {
  return (
    <div className="mb-5">
      <h3 className="text-lg font-semibold tracking-tight">{title}</h3>
      <p className="mt-0.5 text-sm text-muted-foreground">{description}</p>
    </div>
  )
}

/** A big, obvious either/or — the two forks this wizard actually turns on. */
function ChoiceCard({
  selected,
  onSelect,
  title,
  description,
}: {
  selected: boolean
  onSelect: () => void
  title: string
  description: string
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      className={cn(
        'rounded-lg border p-4 text-left transition-colors',
        selected
          ? 'border-primary bg-primary/5 ring-1 ring-primary/30'
          : 'border-border hover:border-primary/40 hover:bg-accent',
      )}
    >
      <p className="font-medium">{title}</p>
      <p className="mt-0.5 text-sm text-muted-foreground">{description}</p>
    </button>
  )
}

type Setter = <K extends keyof MemberDraft>(key: K, value: MemberDraft[K]) => void

function Field({
  label,
  required,
  error,
  hint,
  children,
}: {
  label: string
  required?: boolean
  error?: string | undefined
  hint?: string
  children: ReactNode
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label>
        {label}
        {required && <span className="ml-0.5 text-destructive">*</span>}
      </Label>
      {children}
      {hint && !error && <p className="text-xs text-muted-foreground">{hint}</p>}
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  )
}

function EngagementStep({ draft, set }: { draft: MemberDraft; set: Setter }) {
  return (
    <>
      <StepHeader title="How is this person engaged?" description="Pick one. You can change it later." />
      <div className="grid gap-3 sm:grid-cols-2">
        <ChoiceCard
          selected={draft.engagement_type === 'in_house'}
          onSelect={() => set('engagement_type', 'in_house')}
          title="In-house staff"
          description="On payroll — fixed salary or retainer."
        />
        <ChoiceCard
          selected={draft.engagement_type === 'freelancer'}
          onSelect={() => set('engagement_type', 'freelancer')}
          title="Freelancer / Vendor"
          description="Engaged per project or per shoot."
        />
      </div>
    </>
  )
}

function LoginStep({ draft, set }: { draft: MemberDraft; set: Setter }) {
  return (
    <>
      <StepHeader
        title="Do you want to create a dashboard login?"
        description="A login lets this person sign in to the dashboard. You can enable it later."
      />
      <div className="grid gap-3 sm:grid-cols-2">
        <ChoiceCard
          selected={draft.create_login}
          onSelect={() => set('create_login', true)}
          title="Yes, create login"
          description="They can sign in and see their allowed work."
        />
        <ChoiceCard
          selected={!draft.create_login}
          onSelect={() => set('create_login', false)}
          title="No, offline team member"
          description="Saved in Team Directory and can be assigned to shoots."
        />
      </div>
    </>
  )
}

function ContactStep({
  draft,
  set,
  errors,
}: {
  draft: MemberDraft
  set: Setter
  errors: FieldErrors<keyof MemberDraft>
}) {
  return (
    <>
      <StepHeader
        title={draft.create_login ? 'Their contact & login' : 'Their contact details'}
        description={
          draft.create_login
            ? 'We use the email to create their login. Share the password after saving.'
            : 'No login is created, so an email is optional — a phone number is enough.'
        }
      />
      <div className="flex flex-col gap-4">
        <Field label="Name" required error={errors.name}>
          <Input
            value={draft.name}
            onChange={(e) => set('name', e.target.value)}
            placeholder="Full name"
            aria-invalid={!!errors.name}
            autoFocus
          />
        </Field>
        <Field label="Phone" required error={errors.phone}>
          <Input
            value={draft.phone}
            onChange={(e) => set('phone', e.target.value)}
            placeholder="9876543210"
            aria-invalid={!!errors.phone}
          />
        </Field>
        <Field label="Email" required={draft.create_login} error={errors.email}>
          <Input
            type="email"
            value={draft.email}
            onChange={(e) => set('email', e.target.value)}
            placeholder="name@example.com"
            aria-invalid={!!errors.email}
          />
        </Field>
        <Field label="Alternate phone (optional)">
          <Input
            value={draft.alternate_phone}
            onChange={(e) => set('alternate_phone', e.target.value)}
          />
        </Field>

        {draft.create_login && (
          <div className="rounded-lg border border-border bg-muted/30 p-4">
            <p className="font-medium">Set a starting password</p>
            <p className="mt-0.5 text-sm text-muted-foreground">
              Share this with them. They can change it after first login.
            </p>
            <div className="mt-4 flex flex-col gap-4">
              <Field label="Password" required error={errors.password}>
                <Input
                  type="password"
                  value={draft.password}
                  onChange={(e) => set('password', e.target.value)}
                  placeholder="At least 6 characters"
                  aria-invalid={!!errors.password}
                  autoComplete="new-password"
                />
              </Field>
              <Field label="Confirm password" required error={errors.confirm_password}>
                <Input
                  type="password"
                  value={draft.confirm_password}
                  onChange={(e) => set('confirm_password', e.target.value)}
                  aria-invalid={!!errors.confirm_password}
                  autoComplete="new-password"
                />
              </Field>
            </div>
          </div>
        )}
      </div>
    </>
  )
}

function RoleStep({ draft, set }: { draft: MemberDraft; set: Setter }) {
  const { data: roles } = useEmployeeRoles()
  const toggle = (id: string) =>
    set('role_ids', draft.role_ids.includes(id) ? draft.role_ids.filter((r) => r !== id) : [...draft.role_ids, id])

  return (
    <>
      <StepHeader
        title="What can they do?"
        description="Access decides what they see. Job roles decide what they get booked for."
      />
      <div className="flex flex-col gap-4">
        <Field label="Access level" required hint={ACCESS_HINT[draft.role]}>
          <Select value={draft.role} onChange={(e) => set('role', e.target.value as MemberDraft['role'])}>
            <option value="employee">Employee</option>
            <option value="manager">Manager</option>
            <option value="admin">Admin</option>
          </Select>
        </Field>

        <div className="flex flex-col gap-1.5">
          <Label>Job roles</Label>
          {roles && roles.length > 0 ? (
            <div className="flex flex-wrap gap-2">
              {roles.map((r) => {
                const on = draft.role_ids.includes(r.id)
                return (
                  <button
                    key={r.id}
                    type="button"
                    onClick={() => toggle(r.id)}
                    aria-pressed={on}
                    className={cn(
                      'rounded-full border px-3 py-1.5 text-sm transition-colors',
                      on
                        ? 'border-primary bg-primary/10 text-primary'
                        : 'border-border text-muted-foreground hover:border-primary/40 hover:text-foreground',
                    )}
                  >
                    {r.type_name}
                  </button>
                )
              })}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              No job roles yet. Create them under Roles &amp; Access — you can assign them afterwards.
            </p>
          )}
        </div>
      </div>
    </>
  )
}

const ACCESS_HINT: Record<MemberDraft['role'], string> = {
  employee: 'Sees only their own work, shoots and tasks.',
  manager: 'Runs projects and the production board for the whole studio.',
  admin: 'Everything except owner-only settings and salaries.',
}

function DetailsStep({
  draft,
  set,
  errors,
}: {
  draft: MemberDraft
  set: Setter
  errors: FieldErrors<keyof MemberDraft>
}) {
  const freelance = draft.engagement_type === 'freelancer'
  return (
    <>
      <StepHeader
        title="Anything else on record?"
        description="Both are optional — you can fill them in later from the directory."
      />
      <div className="flex flex-col gap-4">
        <Field
          label={freelance ? 'Standard rate (₹)' : 'Monthly salary (₹)'}
          error={errors.salary}
          hint={
            freelance
              ? 'What you usually pay them per shoot. Only owners can see this.'
              : 'Only owners can see this.'
          }
        >
          <Input
            inputMode="numeric"
            value={draft.salary}
            onChange={(e) => set('salary', e.target.value)}
            placeholder="0"
            aria-invalid={!!errors.salary}
          />
        </Field>
        <Field label="Address" error={errors.address}>
          <Input
            value={draft.address}
            onChange={(e) => set('address', e.target.value)}
            placeholder="City or full address"
          />
        </Field>
      </div>
    </>
  )
}

function ReviewStep({
  draft,
  errors,
}: {
  draft: MemberDraft
  errors: FieldErrors<keyof MemberDraft>
}) {
  const { data: roles } = useEmployeeRoles()
  const jobRoles = (roles ?? []).filter((r) => draft.role_ids.includes(r.id)).map((r) => r.type_name)
  const problems = Object.values(errors).filter(Boolean)

  const rows: Array<[string, string]> = [
    ['Name', draft.name],
    ['Engagement', draft.engagement_type === 'freelancer' ? 'Freelancer / Vendor' : 'In-house staff'],
    ['Phone', [draft.phone, draft.alternate_phone].filter(Boolean).join(' · ')],
    ['Email', draft.email || '—'],
    ['Login', draft.create_login ? 'Yes — password set' : 'No — directory only'],
    ['Access level', humanize(draft.role)],
    ['Job roles', jobRoles.length ? jobRoles.join(', ') : '—'],
    [
      draft.engagement_type === 'freelancer' ? 'Standard rate' : 'Monthly salary',
      draft.salary.trim() ? formatINR(Number(draft.salary)) : '—',
    ],
    ['Address', draft.address || '—'],
  ]

  return (
    <>
      <StepHeader title="Check and add" description="This is what we'll save. Go back to change anything." />
      <dl className="divide-y divide-border rounded-lg border border-border">
        {rows.map(([label, value]) => (
          <div key={label} className="flex gap-4 px-4 py-2.5 text-sm">
            <dt className="w-40 shrink-0 text-muted-foreground">{label}</dt>
            <dd className="min-w-0 flex-1 break-words font-medium">{value || '—'}</dd>
          </div>
        ))}
      </dl>
      {problems.length > 0 && (
        <ul className="mt-4 space-y-1 text-sm text-destructive">
          {problems.map((p) => (
            <li key={p}>{p}</li>
          ))}
        </ul>
      )}
    </>
  )
}
