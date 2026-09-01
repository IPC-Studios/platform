import { useCallback, useRef, type ReactNode } from 'react'
import { cn } from './cn'
import { prefersReducedMotion } from './motion'
import { sheenPosition, tiltFromRect } from './tilt'

/**
 * A card that leans toward the pointer.
 *
 * Only for showcase surfaces — a theme swatch, the sign-in card. Never put it
 * on something people read or scan: text on a rotated plane is harder to read,
 * and a table that moves while you follow a row across it is worse than a flat
 * one.
 *
 * The transform is written straight to the node's custom properties inside a
 * rAF. Pointer moves fire dozens of times a second and routing them through
 * React state would re-render the subtree on every one of them.
 *
 * Tilt is gated on `(hover: hover)` in CSS, so a touch device — where there is
 * no pointer to follow and the transform would just stick — never gets it.
 */
export function TiltCard({
  children,
  className,
  max = 5,
  sheen = true,
}: {
  children: ReactNode
  className?: string
  /** Degrees at the edge. Keep it small; past ~8 the text starts to smear. */
  max?: number
  sheen?: boolean
}) {
  const ref = useRef<HTMLDivElement>(null)
  const frame = useRef(0)

  const onPointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const el = ref.current
      // A stylus or finger reports pointerType 'pen'/'touch'; those have no
      // hover state, so following them fights the user's own scrolling.
      if (!el || e.pointerType !== 'mouse' || prefersReducedMotion()) return
      // Never tilt the plane someone is typing on: text on a rotated surface
      // is measurably harder to read, and the caret drifts with it. Flatten
      // rather than returning, or the card stays stuck at whatever angle it
      // held when the field took focus.
      if (isTyping(el)) return flat(el)

      cancelAnimationFrame(frame.current)
      const { clientX, clientY } = e
      frame.current = requestAnimationFrame(() => {
        const rect = el.getBoundingClientRect()
        const { rotateX, rotateY } = tiltFromRect(clientX, clientY, rect, max)
        const light = sheenPosition(
          (clientX - rect.left) / (rect.width || 1),
          (clientY - rect.top) / (rect.height || 1),
        )
        el.style.setProperty('--tilt-x', `${rotateX}deg`)
        el.style.setProperty('--tilt-y', `${rotateY}deg`)
        el.style.setProperty('--sheen-x', `${light.x}%`)
        el.style.setProperty('--sheen-y', `${light.y}%`)
        el.style.setProperty('--tilt-lift', '1')
      })
    },
    [max],
  )

  const reset = useCallback(() => {
    cancelAnimationFrame(frame.current)
    if (ref.current) flat(ref.current)
  }, [])

  return (
    <div
      ref={ref}
      onPointerMove={onPointerMove}
      onPointerLeave={reset}
      // Focus is keyboard territory: there is no pointer to lean toward, and a
      // card that tilts on tab-in only makes the focus ring harder to place.
      onBlur={reset}
      className={cn('tilt-card', sheen && 'tilt-card--sheen', className)}
    >
      {children}
    </div>
  )
}

function flat(el: HTMLElement) {
  el.style.setProperty('--tilt-x', '0deg')
  el.style.setProperty('--tilt-y', '0deg')
  el.style.setProperty('--tilt-lift', '0')
}

/** True while a text field inside this card holds focus. */
function isTyping(card: HTMLElement): boolean {
  const active = document.activeElement
  if (!active || !card.contains(active)) return false
  return (
    active instanceof HTMLInputElement ||
    active instanceof HTMLTextAreaElement ||
    (active as HTMLElement).isContentEditable
  )
}
