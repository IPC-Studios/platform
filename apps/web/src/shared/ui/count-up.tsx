import { useEffect, useRef, useState } from 'react'

/**
 * Ease-out cubic: fast off the mark, settling gently. Numbers that decelerate
 * read as landing on a value; a linear ramp reads as still counting.
 */
export function easeOutCubic(t: number): number {
  const clamped = Math.min(1, Math.max(0, t))
  return 1 - Math.pow(1 - clamped, 3)
}

/** The value to show `elapsed` ms into a count from `from` to `to`. */
export function countAt(from: number, to: number, elapsed: number, duration: number): number {
  if (duration <= 0 || elapsed >= duration) return to
  return from + (to - from) * easeOutCubic(elapsed / duration)
}

const DURATION = 750

/**
 * A number that counts up to its value on mount and on change.
 *
 * Renders the FINAL value immediately when the visitor prefers reduced motion —
 * and, importantly, whenever the run finishes — so what is on screen is always
 * the real figure. A dashboard that animates money must never leave a stale
 * number showing if a frame is dropped.
 */
export function CountUp({
  value,
  format = (n) => String(Math.round(n)),
  className,
}: {
  value: number
  format?: (n: number) => string
  className?: string
}) {
  const [shown, setShown] = useState(value)
  const fromRef = useRef(value)

  useEffect(() => {
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    if (reduced || !Number.isFinite(value)) {
      setShown(value)
      fromRef.current = value
      return
    }

    const from = fromRef.current
    if (from === value) return
    const start = performance.now()
    let frame = 0

    const tick = (now: number) => {
      const elapsed = now - start
      setShown(countAt(from, value, elapsed, DURATION))
      if (elapsed < DURATION) frame = requestAnimationFrame(tick)
      else fromRef.current = value
    }
    frame = requestAnimationFrame(tick)

    return () => {
      cancelAnimationFrame(frame)
      // Interrupted mid-count: adopt the target so the next run starts from
      // what the user actually saw rather than replaying from the old value.
      fromRef.current = value
    }
  }, [value])

  return <span className={className}>{format(shown)}</span>
}
