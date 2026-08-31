import { describe, it, expect } from 'vitest'
import { easeOutCubic, countAt } from './count-up'

describe('easeOutCubic', () => {
  it('runs from 0 to 1 across the interval', () => {
    expect(easeOutCubic(0)).toBe(0)
    expect(easeOutCubic(1)).toBe(1)
  })

  it('decelerates — more than half the distance is covered by halfway', () => {
    expect(easeOutCubic(0.5)).toBeGreaterThan(0.5)
  })

  it('never overshoots on out-of-range input', () => {
    expect(easeOutCubic(-2)).toBe(0)
    expect(easeOutCubic(4)).toBe(1)
  })

  it('increases monotonically', () => {
    let prev = -1
    for (let t = 0; t <= 1; t += 0.05) {
      const v = easeOutCubic(t)
      expect(v).toBeGreaterThanOrEqual(prev)
      prev = v
    }
  })
})

describe('countAt', () => {
  it('starts at the from value', () => {
    expect(countAt(0, 100, 0, 1000)).toBe(0)
  })

  it('lands exactly on the target at the end', () => {
    // Never approximately — a dashboard must not settle on 99.97 of ₹100.
    expect(countAt(0, 100, 1000, 1000)).toBe(100)
    expect(countAt(0, 100, 5000, 1000)).toBe(100)
  })

  it('stays inside the range while running', () => {
    for (const t of [1, 250, 500, 999]) {
      const v = countAt(0, 100, t, 1000)
      expect(v).toBeGreaterThanOrEqual(0)
      expect(v).toBeLessThanOrEqual(100)
    }
  })

  it('counts downward too', () => {
    expect(countAt(100, 20, 0, 1000)).toBe(100)
    expect(countAt(100, 20, 1000, 1000)).toBe(20)
    const mid = countAt(100, 20, 500, 1000)
    expect(mid).toBeLessThan(100)
    expect(mid).toBeGreaterThan(20)
  })

  it('jumps straight to the target for a zero-length run', () => {
    expect(countAt(0, 42, 0, 0)).toBe(42)
  })

  it('handles a target equal to the start', () => {
    expect(countAt(7, 7, 300, 1000)).toBe(7)
  })
})
