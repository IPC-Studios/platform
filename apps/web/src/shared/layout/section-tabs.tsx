import { cn } from '../ui/cn'

export interface SectionTab<T extends string> {
  value: T
  label: string
}

/**
 * Module-level tabs — the bar under a page title that switches between two
 * views of the same subject (Directory ↔ Salaries). Distinct from FilterTabs,
 * which narrows one list: this one changes what the list IS, so it sits on the
 * page surface and takes the accent when selected.
 */
export function SectionTabs<T extends string>({
  tabs,
  value,
  onChange,
  className,
}: {
  tabs: ReadonlyArray<SectionTab<T>>
  value: T
  onChange: (v: T) => void
  className?: string
}) {
  return (
    <div
      role="tablist"
      className={cn('flex gap-1 rounded-lg border border-border bg-card p-1.5', className)}
    >
      {tabs.map((t) => (
        <button
          key={t.value}
          type="button"
          role="tab"
          aria-selected={value === t.value}
          onClick={() => onChange(t.value)}
          className={cn(
            'rounded-lg px-4 py-2 text-sm font-medium transition-colors',
            value === t.value
              ? 'bg-primary text-primary-foreground'
              : 'text-muted-foreground hover:bg-accent hover:text-foreground',
          )}
        >
          {t.label}
        </button>
      ))}
    </div>
  )
}
