import { describe, expect, it } from 'vitest'
import { NO_TILT, sheenPosition, tiltFor, tiltFromRect } from './tilt'

const MAX = 5

describe('tiltFor', () => {
  it('is flat at the centre', () => {
    expect(tiltFor(0.5, 0.5, MAX)).toEqual({ rotateX: 0, rotateY: 0 })
  })

  it('lifts the edge nearest the pointer, not the far one', () => {
    // The whole effect reads backwards if either sign flips, and a reversed
    // tilt still looks like "an effect" — so both are pinned here.
    // Positive rotateX pushes the top AWAY, so a pointer at the top must be
    // negative for the top to come forward.
    expect(tiltFor(0.5, 0, MAX).rotateX).toBe(-MAX)
    expect(tiltFor(0.5, 1, MAX).rotateX).toBe(MAX)
    // Positive rotateY pushes the right AWAY, so a pointer on the right must
    // be negative for the right to come forward.
    expect(tiltFor(1, 0.5, MAX).rotateY).toBe(-MAX)
    expect(tiltFor(0, 0.5, MAX).rotateY).toBe(MAX)
  })

  it('never exceeds max, however far outside the card the pointer goes', () => {
    const far = tiltFor(-4, 9, MAX)
    expect(Math.abs(far.rotateX)).toBeLessThanOrEqual(MAX)
    expect(Math.abs(far.rotateY)).toBeLessThanOrEqual(MAX)
    expect(far).toEqual({ rotateX: MAX, rotateY: MAX })
  })

  it('scales linearly between the centre and the edge', () => {
    expect(tiltFor(0.5, 0.75, MAX).rotateX).toBe(MAX / 2)
  })

  it('stays flat for values that are not numbers', () => {
    expect(tiltFor(NaN, 0.5, MAX)).toEqual(NO_TILT)
    expect(tiltFor(0.5, Infinity, MAX)).toEqual(NO_TILT)
  })
})

describe('tiltFromRect', () => {
  const rect = { left: 100, top: 50, width: 200, height: 100 }

  it('maps a pointer inside the box', () => {
    // Dead centre of the box.
    expect(tiltFromRect(200, 100, rect, MAX)).toEqual({ rotateX: 0, rotateY: 0 })
    // Top-left corner: both edges lift.
    expect(tiltFromRect(100, 50, rect, MAX)).toEqual({ rotateX: -MAX, rotateY: MAX })
  })

  it('refuses to divide by a collapsed box', () => {
    // An element measured before layout reports 0×0; without this the card
    // would be sent to Infinity degrees.
    expect(tiltFromRect(10, 10, { left: 0, top: 0, width: 0, height: 100 }, MAX)).toEqual(NO_TILT)
    expect(tiltFromRect(10, 10, { left: 0, top: 0, width: 100, height: 0 }, MAX)).toEqual(NO_TILT)
  })
})

describe('sheenPosition', () => {
  it('follows the pointer as a percentage', () => {
    expect(sheenPosition(0.25, 0.75)).toEqual({ x: 25, y: 75 })
  })

  it('clamps, and centres when given nonsense', () => {
    expect(sheenPosition(2, -1)).toEqual({ x: 100, y: 0 })
    expect(sheenPosition(NaN, 0.5)).toEqual({ x: 50, y: 50 })
  })
})
