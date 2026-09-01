import { cn } from './cn'
import { areaPath, linePath, scaleFor, shareOf, trendPercent, type Point } from './chart-geometry'

/**
 * Small charts, drawn as inline SVG.
 *
 * No charting library: these are bars, a line and a stacked bar, and a
 * dependency for that would cost more in bundle size than it saves in code.
 * Everything is painted with `currentColor` or a theme token, so a chart
 * follows the studio's palette and both colour schemes for free.
 */

/** A month or a category, as bars. Values are labelled on hover. */
export function BarChart({
  points,
  format = (n: number) => String(n),
  className,
  height = 'h-28',
}: {
  points: readonly Point[]
  format?: (value: number) => string
  className?: string
  height?: string
}) {
  const scale = scaleFor(points.map((p) => p.value))

  if (points.length === 0) return <ChartEmpty className={className} />

  return (
    <div className={cn('flex flex-col gap-2', className)}>
      <div className={cn('flex items-end gap-1.5', height)}>
        {points.map((p) => (
          <div key={p.label} className="group flex h-full flex-1 flex-col justify-end">
            <span
              title={`${p.label}: ${format(p.value)}`}
              style={{ height: `${Math.max(scale.percent(p.value), p.value > 0 ? 2 : 0)}%` }}
              className={cn(
                'w-full rounded-t bg-primary/70 transition-[height,background-color] duration-500',
                'group-hover:bg-primary',
                // A zero month still needs a footprint, or the axis looks broken.
                p.value === 0 && 'h-px bg-border',
              )}
            />
          </div>
        ))}
      </div>
      <div className="flex gap-1.5">
        {points.map((p) => (
          <span key={p.label} className="flex-1 truncate text-center text-[0.65rem] text-muted-foreground">
            {p.label}
          </span>
        ))}
      </div>
    </div>
  )
}

/**
 * A trend line with a tinted area under it. Sized by its container, so it
 * stretches to whatever card it lands in.
 */
export function TrendChart({
  points,
  format = (n: number) => String(n),
  className,
  height = 'h-28',
}: {
  points: readonly Point[]
  format?: (value: number) => string
  className?: string
  height?: string
}) {
  const values = points.map((p) => p.value)
  const scale = scaleFor(values)
  const trend = trendPercent(values)

  if (points.length === 0) return <ChartEmpty className={className} />

  return (
    <div className={cn('flex flex-col gap-2', className)}>
      <div className={cn('relative w-full', height)}>
        <svg
          viewBox="0 0 100 100"
          preserveAspectRatio="none"
          className="size-full overflow-visible text-primary"
          role="img"
          aria-label={`Trend from ${format(values[0] ?? 0)} to ${format(values[values.length - 1] ?? 0)}`}
        >
          <path d={areaPath(values, scale)} fill="currentColor" opacity={0.12} />
          <path
            d={linePath(values, scale)}
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            // The viewBox is stretched by preserveAspectRatio: without this the
            // stroke stretches with it and the line looks like a wedge.
            vectorEffect="non-scaling-stroke"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </div>
      <div className="flex items-center justify-between text-[0.65rem] text-muted-foreground">
        <span>{points[0]?.label}</span>
        {trend !== null && (
          <span className={cn('font-medium', trend >= 0 ? 'text-success' : 'text-destructive')}>
            {trend >= 0 ? '↑' : '↓'} {Math.abs(trend)}%
          </span>
        )}
        <span>{points[points.length - 1]?.label}</span>
      </div>
    </div>
  )
}

const SHARE_TONES = [
  'bg-primary',
  'bg-primary/70',
  'bg-primary/50',
  'bg-warning',
  'bg-success',
  'bg-muted-foreground/40',
]

/** One stacked bar plus a legend — a pie chart's job without the geometry. */
export function ShareChart({
  points,
  format = (n: number) => String(n),
  className,
}: {
  points: readonly Point[]
  format?: (value: number) => string
  className?: string
}) {
  const slices = shareOf(points)
  if (slices.length === 0) return <ChartEmpty className={className} />

  return (
    <div className={cn('flex flex-col gap-3', className)}>
      <div className="flex h-3 w-full overflow-hidden rounded-full">
        {slices.map((s, i) => (
          <span
            key={s.label}
            title={`${s.label}: ${format(s.value)}`}
            style={{ width: `${s.percent}%` }}
            className={cn('h-full transition-[width] duration-500', SHARE_TONES[i % SHARE_TONES.length])}
          />
        ))}
      </div>
      <ul className="flex flex-col gap-1.5">
        {slices.map((s, i) => (
          <li key={s.label} className="flex items-center gap-2 text-sm">
            <span className={cn('size-2.5 shrink-0 rounded-full', SHARE_TONES[i % SHARE_TONES.length])} />
            <span className="min-w-0 flex-1 truncate text-muted-foreground">{s.label}</span>
            <span className="tabular-nums">{format(s.value)}</span>
            <span className="w-10 text-right tabular-nums text-muted-foreground">
              {Math.round(s.percent)}%
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}

function ChartEmpty({ className }: { className?: string | undefined }) {
  return (
    <p className={cn('py-8 text-center text-sm text-muted-foreground', className)}>
      Not enough data to chart yet.
    </p>
  )
}
