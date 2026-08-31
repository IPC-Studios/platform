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
  { top: '12%', left: '8%', size: 190, variant: '' },
  { top: '62%', left: '18%', size: 130, variant: 'cb-bokeh--slow' },
  { top: '22%', left: '78%', size: 160, variant: 'cb-bokeh--slower' },
  { top: '72%', left: '68%', size: 220, variant: 'cb-bokeh--slow' },
  { top: '44%', left: '46%', size: 110, variant: 'cb-bokeh--slower' },
]

/**
 * Sign-in background: an aperture iris breathing open and shut behind drifting
 * bokeh. Drawn in `currentColor` at very low alpha, so it reads on both light
 * and dark surfaces without introducing a colour of its own — the page's
 * palette is left exactly as it was.
 *
 * Decorative: aria-hidden, pointer-events-none, and completely still when the
 * visitor prefers reduced motion.
 */
export function CameraBackdrop() {
  return (
    <div className="cb-root" aria-hidden>
      {BOKEH.map((b) => (
        <span
          key={`${b.top}-${b.left}`}
          className={`cb-bokeh ${b.variant}`}
          style={{ top: b.top, left: b.left, width: b.size, height: b.size }}
        />
      ))}

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
    </div>
  )
}
