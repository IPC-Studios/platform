import { useEffect, useRef } from 'react'
import { prefersReducedMotion } from '../ui/motion'
import './camera-backdrop.css'

/** A point on a circle of `radius` at `degrees`, with 0 pointing straight up. */
export function pointOnCircle(radius: number, degrees: number): { x: number; y: number } {
  const rad = (degrees - 90) * (Math.PI / 180)
  return {
    x: Number((Math.cos(rad) * radius).toFixed(2)),
    y: Number((Math.sin(rad) * radius).toFixed(2)),
  }
}

/**
 * Points of a regular polygon on a circle of `radius`, centred on the origin.
 * `rotation` is in degrees; 0 puts the first vertex straight up.
 */
export function polygonPoints(sides: number, radius: number, rotation = 0): string {
  return Array.from({ length: sides }, (_, i) => {
    const { x, y } = pointOnCircle(radius, (i * 360) / sides + rotation)
    return `${x},${y}`
  }).join(' ')
}

const OPENING = 92
const BARREL = 104

/**
 * The blade edges. Each runs from a corner of the opening OUT to the barrel,
 * swept tangentially — a real diaphragm's blades pivot at the rim, so nothing
 * converges on the centre. Lines drawn to the middle read as a wheel, not a lens.
 */
const BLADE_SWEEP = 40
const BLADES = Array.from({ length: 6 }, (_, i) => {
  const from = pointOnCircle(OPENING, i * 60)
  const to = pointOnCircle(BARREL, i * 60 + BLADE_SWEEP)
  return { key: i, x1: from.x, y1: from.y, x2: to.x, y2: to.y }
})

/** Defocused highlights: position, size and which drift timing to use. */
const BOKEH = [
  { top: '12%', left: '8%', size: 190, variant: '', depth: 0.9 },
  { top: '62%', left: '18%', size: 130, variant: 'cb-bokeh--slow', depth: 0.55 },
  { top: '22%', left: '78%', size: 160, variant: 'cb-bokeh--slower', depth: 0.75 },
  { top: '72%', left: '68%', size: 220, variant: 'cb-bokeh--slow', depth: 1 },
  { top: '44%', left: '46%', size: 110, variant: 'cb-bokeh--slower', depth: 0.35 },
]

/** Rings in the lens barrel, and the gap between them in Z. */
export const BARREL_RINGS = 7
const RING_GAP = 64

/**
 * Where ring `i` sits in the barrel, `0` being the front element.
 *
 * Three things happen together as a ring recedes, and it is the combination
 * that reads as a tube rather than as flat circles: it moves back in Z, it
 * narrows (a lens barrel tapers toward the mount), and it fades (haze eats
 * contrast with distance). Drop any one and the depth stops being legible.
 */
export function barrelRing(i: number, count = BARREL_RINGS) {
  const t = count <= 1 ? 0 : i / (count - 1)
  return {
    z: Number((-(i * RING_GAP)).toFixed(2)),
    scale: Number((1 - t * 0.38).toFixed(3)),
    // Never reaches zero: the far ring should be faint, not absent, or the
    // barrel looks cut off rather than deep.
    opacity: Number((0.5 - t * 0.38).toFixed(3)),
  }
}

/**
 * Sign-in background: an aperture iris breathing open and shut behind drifting
 * bokeh. Drawn in `currentColor` at very low alpha, so it reads on both light
 * and dark surfaces without introducing a colour of its own — the page's
 * palette is left exactly as it was.
 *
 * Decorative: aria-hidden, pointer-events-none, and completely still when the
 * visitor prefers reduced motion.
 */
/**
 * Track the pointer across the viewport as two 0-1 custom properties, so the
 * layers can be moved in CSS. Written straight to the node inside a rAF: this
 * fires on every pointer move and React state here would re-render the tree
 * dozens of times a second for a decoration.
 */
function useParallax(ref: React.RefObject<HTMLDivElement | null>) {
  useEffect(() => {
    const el = ref.current
    if (!el || prefersReducedMotion()) return
    // No pointer to follow on a touchscreen, and matchMedia is the same gate
    // the CSS uses.
    if (!window.matchMedia('(hover: hover)').matches) return

    let frame = 0
    const onMove = (e: PointerEvent) => {
      if (e.pointerType !== 'mouse') return
      cancelAnimationFrame(frame)
      const { clientX, clientY } = e
      frame = requestAnimationFrame(() => {
        el.style.setProperty('--cb-x', String(clientX / window.innerWidth))
        el.style.setProperty('--cb-y', String(clientY / window.innerHeight))
      })
    }

    window.addEventListener('pointermove', onMove, { passive: true })
    return () => {
      cancelAnimationFrame(frame)
      window.removeEventListener('pointermove', onMove)
    }
  }, [ref])
}

/**
 * Sign-in background: an aperture iris breathing open and shut behind drifting
 * bokeh, on separate planes of a shallow 3D scene. Moving the pointer shifts
 * the near highlights further than the far iris, which is what reads as depth
 * rather than as a picture that wobbles.
 *
 * Each moving part is wrapped in its own parallax layer instead of having the
 * offset added to its animation: the bokeh already animate `transform`, and a
 * second transform on the same element replaces the first rather than adding
 * to it.
 *
 * Drawn in `currentColor` at very low alpha, so it reads on both light and
 * dark surfaces without introducing a colour of its own.
 *
 * Decorative: aria-hidden, pointer-events-none, and completely still when the
 * visitor prefers reduced motion.
 */
export function CameraBackdrop() {
  const ref = useRef<HTMLDivElement>(null)
  useParallax(ref)

  return (
    <div className="cb-root" ref={ref} aria-hidden>
      {BOKEH.map((b) => (
        <span
          key={`${b.top}-${b.left}`}
          className="cb-layer"
          style={{ '--d': b.depth } as React.CSSProperties}
        >
          <span
            className={`cb-bokeh ${b.variant}`}
            style={{ top: b.top, left: b.left, width: b.size, height: b.size }}
          />
        </span>
      ))}

      {/* The barrel sits furthest back, so it barely moves with the pointer. */}
      <span className="cb-layer cb-layer--iris" style={{ '--d': 0.18 } as React.CSSProperties}>
        {/* The lens: rings receding into the screen, turning slowly off-axis
            so you see into the tube rather than straight down it. */}
        <div className="cb-barrel">
          {Array.from({ length: BARREL_RINGS }, (_, i) => {
            const { z, scale, opacity } = barrelRing(i)
            return (
              <span
                key={i}
                className="cb-ring3d"
                style={
                  {
                    '--z': `${z}px`,
                    '--s': scale,
                    '--o': opacity,
                  } as React.CSSProperties
                }
              />
            )
          })}
        </div>

        <svg className="cb-iris" viewBox="-120 -120 240 240" fill="none">
          {/* Barrel rings — the fixed part of the lens. */}
          <circle r="116" className="cb-ring" />
          <circle r={BARREL} className="cb-ring cb-ring--faint" />

          {/* The diaphragm: the opening, plus the blades that stop it down. */}
          <g className="cb-diaphragm">
            <polygon points={polygonPoints(6, OPENING)} className="cb-blade-edge" />
            {BLADES.map((b) => (
              <line key={b.key} x1={b.x1} y1={b.y1} x2={b.x2} y2={b.y2} className="cb-blade" />
            ))}
          </g>
        </svg>
      </span>
    </div>
  )
}
