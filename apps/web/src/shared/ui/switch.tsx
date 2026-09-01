import { cn } from './cn'

/**
 * A yes/no that takes effect where it sits — no Save button between the flip
 * and the meaning. Built on a real `role="switch"` button so it announces its
 * state and works from the keyboard without a dependency.
 */
export function Switch({
  checked,
  onChange,
  label,
  description,
  disabled,
  className,
}: {
  checked: boolean
  onChange: (next: boolean) => void
  label: string
  description?: string
  disabled?: boolean
  className?: string
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        'group flex w-full items-center gap-3 text-left disabled:cursor-not-allowed disabled:opacity-50',
        className,
      )}
    >
      <span
        className={cn(
          'relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors',
          'group-focus-visible:outline-none group-focus-visible:ring-2 group-focus-visible:ring-ring',
          checked ? 'bg-primary' : 'bg-muted-foreground/30',
        )}
      >
        <span
          className={cn(
            'inline-block size-5 rounded-full bg-background shadow-sm transition-transform',
            checked ? 'translate-x-[1.375rem]' : 'translate-x-0.5',
          )}
        />
      </span>
      <span className="min-w-0">
        <span className="block text-sm font-medium">{label}</span>
        {description && (
          <span className="block text-xs text-muted-foreground">{description}</span>
        )}
      </span>
    </button>
  )
}
