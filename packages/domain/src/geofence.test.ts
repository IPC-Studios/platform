import { describe, expect, it } from 'vitest'
import { haversineMeters, withinFence } from './geofence'

// Two points ~111m apart (0.001 deg latitude).
const studio = { lat: 19.076, lng: 72.8777 } // Mumbai
const nearby = { lat: 19.0765, lng: 72.8777 }
const farAway = { lat: 19.2, lng: 72.9 }

describe('haversineMeters', () => {
  it('is ~0 for the same point', () => {
    expect(haversineMeters(studio, studio)).toBe(0)
  })
  it('measures a small offset in the tens of metres', () => {
    const d = haversineMeters(studio, nearby)
    expect(d).toBeGreaterThan(40)
    expect(d).toBeLessThan(70)
  })
})

describe('withinFence', () => {
  it('accepts a point inside the radius', () => {
    expect(withinFence(nearby, studio, 100)).toBe(true)
  })
  it('rejects a point outside the radius', () => {
    expect(withinFence(nearby, studio, 30)).toBe(false)
    expect(withinFence(farAway, studio, 200)).toBe(false)
  })
})
