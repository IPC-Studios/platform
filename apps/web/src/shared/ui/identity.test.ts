import { describe, expect, it } from 'vitest'
import { avatarColors, hueFor, initialsFor } from './identity'

describe('initialsFor', () => {
  it('takes the first and last word', () => {
    expect(initialsFor('Rahul Sharma')).toBe('RS')
    expect(initialsFor('Aanya Priya Verma')).toBe('AV')
  })

  it('falls back to two letters of a single name', () => {
    expect(initialsFor('Sana')).toBe('SA')
    expect(initialsFor('X')).toBe('X')
  })

  it('never renders blank for a missing or junk name', () => {
    // An empty circle in a list reads as a rendering bug.
    expect(initialsFor(null)).toBe('?')
    expect(initialsFor('')).toBe('?')
    expect(initialsFor('   ')).toBe('?')
    expect(initialsFor('—')).toBe('?')
  })

  it('copes with punctuation and extra spacing', () => {
    expect(initialsFor('  Roy,  Jr.  ')).toBe('RJ')
    expect(initialsFor("D'Souza")).toBe('DS')
  })
})

describe('hueFor', () => {
  it('gives the same person the same colour every time', () => {
    // The point of deriving it: no storage, and it matches across screens.
    expect(hueFor('Rahul Sharma')).toBe(hueFor('Rahul Sharma'))
    expect(hueFor('rahul sharma')).toBe(hueFor('  Rahul Sharma  '))
  })

  it('separates different people', () => {
    expect(hueFor('Rahul Sharma')).not.toBe(hueFor('Sana Khan'))
  })

  it('stays inside the colour wheel', () => {
    for (const name of ['a', 'Sana Khan', 'Zzzz Yyyy', '9876543210', '']) {
      const hue = hueFor(name)
      expect(hue).toBeGreaterThanOrEqual(0)
      expect(hue).toBeLessThan(360)
    }
  })
})

describe('avatarColors', () => {
  it('pairs a light tint with dark ink of the same hue', () => {
    const light = avatarColors('Rahul Sharma')
    expect(light.background).toContain('oklch(0.92')
    expect(light.color).toContain('oklch(0.42')
    // Same hue on both halves, or the circle reads as two colours.
    const hue = hueFor('Rahul Sharma')
    expect(light.background).toContain(`${hue})`)
    expect(light.color).toContain(`${hue})`)
  })

  it('inverts the pairing for dark surfaces', () => {
    const dark = avatarColors('Rahul Sharma', true)
    expect(dark.background).toContain('oklch(0.32')
    expect(dark.color).toContain('oklch(0.88')
  })
})
