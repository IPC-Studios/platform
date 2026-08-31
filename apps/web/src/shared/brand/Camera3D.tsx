import { useEffect, useRef, useState } from 'react'
import './camera.css'

/**
 * Lens barrel discs, outermost first: diameter, how far each stands proud of
 * the body, and an optional treatment. Ordering matters — they are painted back
 * to front so the nearer disc occludes the one behind it.
 */
const RINGS: { size: number; z: number; variant?: 'knurl' | 'accent' }[] = [
  { size: 152, z: 56 },
  { size: 138, z: 80, variant: 'knurl' },
  { size: 124, z: 100 },
  { size: 112, z: 116, variant: 'accent' },
]

const GLASS = { size: 96, z: 120 }

/** How far the body leans toward the pointer, in degrees. */
const MAX_TILT = 12

/**
 * A CSS-3D camera for the sign-in screen. Built from real boxes and stacked
 * discs rather than a flat illustration, so the parallax between the lens
 * barrel and the body is genuine as it turns.
 *
 * Decorative only: `aria-hidden`, and it drops all motion (including pointer
 * tracking) when the visitor has asked for reduced motion.
 */
export function Camera3D({ className }: { className?: string }) {
  const tiltRef = useRef<HTMLDivElement>(null)
  const [reduced, setReduced] = useState(false)

  useEffect(() => {
    const query = window.matchMedia('(prefers-reduced-motion: reduce)')
    const sync = () => setReduced(query.matches)
    sync()
    query.addEventListener('change', sync)
    return () => query.removeEventListener('change', sync)
  }, [])

  useEffect(() => {
    if (reduced) return
    let frame = 0

    function onMove(e: PointerEvent) {
      // Coalesced into one write per frame: pointermove can fire far faster
      // than the compositor paints, and every write here forces a transform.
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => {
        const el = tiltRef.current
        if (!el) return
        const x = (e.clientX / window.innerWidth - 0.5) * 2
        const y = (e.clientY / window.innerHeight - 0.5) * 2
        el.style.setProperty('--cam-tilt-y', `${(x * MAX_TILT).toFixed(2)}deg`)
        el.style.setProperty('--cam-tilt-x', `${(-y * MAX_TILT).toFixed(2)}deg`)
      })
    }

    window.addEventListener('pointermove', onMove, { passive: true })
    return () => {
      window.removeEventListener('pointermove', onMove)
      cancelAnimationFrame(frame)
    }
  }, [reduced])

  return (
    <div className={`cam-stage ${className ?? ''}`} aria-hidden>
      <div className="cam-tilt" ref={tiltRef}>
        <div className="cam-spin">
          <div className="cam-body">
            <span className="cam-shadow" />

            <span className="cam-face cam-face--back" />
            <span className="cam-face cam-face--left" />
            <span className="cam-face cam-face--right" />
            <span className="cam-face cam-face--top" />
            <span className="cam-face cam-face--bottom" />
            <span className="cam-face cam-face--front" />

            <span className="cam-grip" />

            <div className="cam-prism">
              <span className="cam-prism-face cam-prism-face--back" />
              <span className="cam-prism-face cam-prism-face--left" />
              <span className="cam-prism-face cam-prism-face--right" />
              <span className="cam-prism-face cam-prism-face--top" />
              <span className="cam-prism-face cam-prism-face--front" />
            </div>

            <span className="cam-shutter" />

            <div className="cam-lens">
              {RINGS.map((ring) => (
                <span
                  key={ring.z}
                  className={`cam-ring${ring.variant ? ` cam-ring--${ring.variant}` : ''}`}
                  style={{
                    width: ring.size,
                    height: ring.size,
                    transform: `translate(-50%, -50%) translateZ(${ring.z}px)`,
                  }}
                />
              ))}
              <span
                className="cam-glass"
                style={{
                  width: GLASS.size,
                  height: GLASS.size,
                  transform: `translate(-50%, -50%) translateZ(${GLASS.z}px)`,
                }}
              >
                <span className="cam-glint" />
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
