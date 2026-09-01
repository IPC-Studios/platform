import { useEffect, useRef, useState } from 'react'
import { prefersReducedMotion } from './motion'

/** Ease-out: fast to begin, settling at the end, the way a tally lands. */
const easeOut = (t: number) => 1 - Math.pow(1 - t, 3)

/**
 * A number that counts up to its value.
 *
 * The stat tiles are the first thing on six pages, and a figure that arrives
 * already still reads as a static image. This is decoration with a job: the
 * movement says the number was just computed.
 *
 * It never lies — the final frame is always exactly `value`, and anyone who
 * asked for less motion gets it immediately.
 */
export function CountUp({
  value,
  duration = 450,
  format = (n: number) => String(n),
  className,
}: {
  value: number
  duration?: number
  format?: (n: number) => string
  className?: string
}) {
  const [shown, setShown] = useState(value)
  const from = useRef(value)

  useEffect(() => {
    if (prefersReducedMotion() || from.current === value) {
      setShown(value)
      from.current = value
      return
    }

    const start = performance.now()
    const begin = from.current
    let frame = 0

    const tick = (now: number) => {
      const progress = Math.min(1, (now - start) / duration)
      // Round toward the target so the last frame is the real value, not a
      // rounding of it.
      setShown(begin + (value - begin) * easeOut(progress))
      if (progress < 1) frame = requestAnimationFrame(tick)
      else {
        setShown(value)
        from.current = value
      }
    }

    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [value, duration])

  return <span className={className}>{format(Math.round(shown))}</span>
}
