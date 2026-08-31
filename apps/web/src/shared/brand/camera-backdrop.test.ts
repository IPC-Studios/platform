import { describe, it, expect } from 'vitest'
import { pointOnCircle, polygonPoints } from './CameraBackdrop'

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
