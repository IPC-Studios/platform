import { describe, expect, it } from 'vitest'
import {
  FONT_CONTRACT_KEYS,
  FONT_KEYS,
  FONT_OPTIONS,
  fontHref,
  fontOr,
  fontStack,
} from './fonts'

describe('theme fonts', () => {
  it('matches the allow-list the server validates against', () => {
    // Drift here means a studio could save a font the API rejects, or the API
    // could accept a key the app has no family for.
    expect([...FONT_KEYS].sort()).toEqual([...FONT_CONTRACT_KEYS].sort())
  })

  it('always keeps a real fallback behind the webfont', () => {
    for (const font of Object.values(FONT_OPTIONS)) {
      const stack = fontStack(font)
      expect(stack, font.key).toContain(`'${font.family}'`)
      // A face that fails to load must land on a system family, not nothing.
      expect(stack.split(',').length, font.key).toBeGreaterThan(2)
    }
  })

  it('asks Google for the weights we render, and for swap', () => {
    const href = fontHref(FONT_OPTIONS.playfair)
    expect(href).toContain('family=Playfair+Display')
    expect(href).toContain('wght@400;500;600;700')
    // Without swap the first paint is invisible text on a slow connection.
    expect(href).toContain('display=swap')
  })

  it('falls back to the theme font when the stored key is gone or absent', () => {
    expect(fontOr(null, 'lato').key).toBe('lato')
    expect(fontOr(undefined, 'lato').key).toBe('lato')
    expect(fontOr('comic_sans', 'lato').key).toBe('lato')
    expect(fontOr('poppins', 'lato').key).toBe('poppins')
  })

  it('describes every face, so no card ships with an empty hint', () => {
    for (const font of Object.values(FONT_OPTIONS)) {
      expect(font.hint.length, font.key).toBeGreaterThan(10)
    }
  })
})
