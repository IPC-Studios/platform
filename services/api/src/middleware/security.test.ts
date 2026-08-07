import { describe, expect, it } from 'vitest'
import { slidingWindow } from './security'

describe('slidingWindow rate limit', () => {
  it('allows up to the limit within the window', () => {
    let hits: number[] = []
    for (let i = 0; i < 3; i++) {
      const r = slidingWindow(hits, 1000 + i, 10_000, 3)
      expect(r.allowed).toBe(true)
      hits = r.next
    }
    // 4th hit in the window is blocked.
    expect(slidingWindow(hits, 1003, 10_000, 3).allowed).toBe(false)
  })

  it('forgets hits older than the window', () => {
    const old = [1, 2, 3] // long ago
    const r = slidingWindow(old, 1_000_000, 10_000, 3)
    expect(r.allowed).toBe(true)
    expect(r.next).toEqual([1_000_000]) // old ones pruned
  })
})
