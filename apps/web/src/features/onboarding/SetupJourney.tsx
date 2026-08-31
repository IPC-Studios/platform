import { Link } from '@tanstack/react-router'
import {
  Sparkles,
  Users,
  UserPlus,
  FolderPlus,
  CalendarDays,
  Database,
  IndianRupee,
  Activity,
  ArrowRight,
  Check,
  Lock,
  type LucideIcon,
} from 'lucide-react'
import { Card, CardContent } from '@/shared/ui/card'
import { Button } from '@/shared/ui/button'
import { cn } from '@/shared/ui/cn'
import type { JourneyStep, JourneyStepKey } from './journey'

const ICONS: Record<JourneyStepKey, LucideIcon> = {
  team: Users,
  client: UserPlus,
  project: FolderPlus,
  booking: CalendarDays,
  data: Database,
  payment: IndianRupee,
  tracking: Activity,
}

interface Props {
  steps: JourneyStep[]
  completed: number
  total: number
}

/**
 * The setup checklist a new studio sees on its dashboard. It is a guide, not a
 * gate: an "upcoming" step is de-emphasised so the eye lands on the current
 * one, but its link still works — nothing here should trap someone who knows
 * what they want to do next.
 */
export function SetupJourney({ steps, completed, total }: Props) {
  const pct = total === 0 ? 0 : Math.round((completed / total) * 100)

  return (
    <Card className="mb-6 overflow-hidden">
      <CardContent className="p-5 sm:p-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex gap-3">
            <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <Sparkles className="size-5" />
            </span>
            <div>
              <h2 className="text-lg font-semibold tracking-tight">Studio Setup Journey</h2>
              <p className="mt-0.5 text-sm text-muted-foreground">
                Follow these steps to set up your studio. We'll guide you through one at a time.
              </p>
            </div>
          </div>

          <div className="sm:min-w-44 sm:text-right">
            <p className="text-[0.7rem] font-medium uppercase tracking-wider text-muted-foreground">
              Progress
            </p>
            <p className="text-sm font-semibold">
              {completed} of {total} steps completed
            </p>
            <div
              className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-muted"
              role="progressbar"
              aria-valuenow={completed}
              aria-valuemin={0}
              aria-valuemax={total}
              aria-label="Studio setup progress"
            >
              <div
                className="h-full rounded-full bg-primary transition-[width] duration-500"
                style={{ width: `${pct}%` }}
              />
            </div>
          </div>
        </div>

        <ol className="mt-5 flex flex-col gap-2.5">
          {steps.map((step) => (
            <StepRow key={step.key} step={step} />
          ))}
        </ol>
      </CardContent>
    </Card>
  )
}

function StepRow({ step }: { step: JourneyStep }) {
  const Icon = ICONS[step.key]
  const isCurrent = step.state === 'current'
  const isDone = step.state === 'done'

  return (
    <li
      className={cn(
        'rounded-lg border p-3.5 transition-colors sm:p-4',
        isCurrent
          ? 'border-primary/40 bg-primary/[0.04] ring-1 ring-primary/20'
          : 'border-border bg-card',
      )}
      // Announced as "Step 3, completed" rather than leaving the state to colour alone.
      aria-label={`Step ${step.step} — ${step.title}, ${STATE_LABEL[step.state].toLowerCase()}`}
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
        <div className="flex min-w-0 gap-3">
          <Marker step={step} />
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <Icon
                className={cn(
                  'size-4 shrink-0',
                  isCurrent ? 'text-primary' : 'text-muted-foreground',
                )}
                aria-hidden
              />
              <span className={cn('font-medium', isDone && 'text-muted-foreground')}>
                Step {step.step} — {step.title}
              </span>
              <StateChip state={step.state} />
            </div>
            <p className="mt-1 text-sm text-muted-foreground">{step.description}</p>
          </div>
        </div>

        <Button
          asChild
          size="sm"
          variant={isCurrent ? 'default' : 'outline'}
          className="shrink-0 self-start sm:self-auto"
        >
          <Link to={step.action.to}>
            {step.action.label} <ArrowRight />
          </Link>
        </Button>
      </div>
    </li>
  )
}

/** The numbered / ticked / locked bubble on the left of a row. */
function Marker({ step }: { step: JourneyStep }) {
  if (step.state === 'done') {
    return (
      <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-success/15 text-success">
        <Check className="size-4" aria-hidden />
      </span>
    )
  }
  if (step.state === 'current') {
    return (
      <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary text-sm font-semibold text-primary-foreground">
        {step.step}
      </span>
    )
  }
  return (
    <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
      <Lock className="size-3.5" aria-hidden />
    </span>
  )
}

const STATE_LABEL = {
  done: 'Completed',
  current: 'Current step',
  upcoming: 'Next',
} as const

function StateChip({ state }: { state: JourneyStep['state'] }) {
  return (
    <span
      className={cn(
        'rounded-full border px-2 py-0.5 text-[0.7rem] font-medium',
        state === 'current'
          ? 'border-primary/30 bg-primary/10 text-primary'
          : state === 'done'
            ? 'border-success/30 bg-success/10 text-success'
            : 'border-border text-muted-foreground',
      )}
    >
      {STATE_LABEL[state]}
    </span>
  )
}
