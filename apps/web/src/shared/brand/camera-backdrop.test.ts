import { describe, it, expect } from 'vitest'
import { BARREL_RINGS, barrelRing, pointOnCircle, polygonPoints } from './CameraBackdrop'

describe('pointOnCircle', () => {
  it('puts 0° straight up, not to the right', () => {
    // SVG's y axis grows downward, so "up" is negative y.
    expect(pointOnCircle(100, 0)).toEqual({ x: 0, y: -100 })
  })

  it('walks clockwise through the quarters', () => {
    // toBeCloseTo, not toEqual: cos/sin yield signed zeros at the quarters and
    // -0 is not 0 to a deep-equality check.
    const quarters: [number, number, number][] = [
      [90, 100, 0],
      [180, 0, 100],
      [270, -100, 0],
    ]
    for (const [deg, x, y] of quarters) {
      const p = pointOnCircle(100, deg)
      expect(p.x).toBeCloseTo(x, 1)
      expect(p.y).toBeCloseTo(y, 1)
    }
  })

  it('stays on the circle at arbitrary angles', () => {
    for (const deg of [17, 40, 133, 288]) {
      const { x, y } = pointOnCircle(92, deg)
      expect(Math.hypot(x, y)).toBeCloseTo(92, 1)
    }
  })
})

describe('polygonPoints', () => {
  it('produces one point per side', () => {
    expect(polygonPoints(6, 92).split(' ')).toHaveLength(6)
  })

  it('places every vertex on the circle', () => {
    for (const pair of polygonPoints(6, 92).split(' ')) {
      const [x, y] = pair.split(',').map(Number)
      expect(Math.hypot(x!, y!)).toBeCloseTo(92, 1)
    }
  })

  it('starts the hexagon at the top', () => {
    expect(polygonPoints(6, 100).split(' ')[0]).toBe('0,-100')
  })

  it('honours rotation', () => {
    expect(polygonPoints(4, 100, 45).split(' ')[0]).not.toBe('0,-100')
  })
})

describe('barrelRing', () => {
  const rings = Array.from({ length: BARREL_RINGS }, (_, i) => barrelRing(i))

  it('starts the front element at the viewer, not behind them', () => {
    expect(rings[0]).toMatchObject({ z: 0, scale: 1 })
  })

  it('recedes, narrows and fades together', () => {
    // All three have to move the same way. A ring that goes back without
    // narrowing and fading reads as a flat circle, not a barrel.
    for (let i = 1; i < rings.length; i++) {
      expect(rings[i]!.z).toBeLessThan(rings[i - 1]!.z)
      expect(rings[i]!.scale).toBeLessThan(rings[i - 1]!.scale)
      expect(rings[i]!.opacity).toBeLessThan(rings[i - 1]!.opacity)
    }
  })

  it('keeps the furthest ring faint but present', () => {
    // Fading to zero would read as the barrel being cut off rather than deep.
    const last = rings[rings.length - 1]!
    expect(last.opacity).toBeGreaterThan(0)
    expect(last.opacity).toBeLessThan(0.2)
    expect(last.scale).toBeGreaterThan(0.5)
  })

  it('survives a single-ring barrel without dividing by zero', () => {
    expect(barrelRing(0, 1)).toEqual({ z: 0, scale: 1, opacity: 0.5 })
  })
})
