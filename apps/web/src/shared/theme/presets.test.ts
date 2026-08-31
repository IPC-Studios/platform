import { describe, it, expect } from 'vitest'
import { themePresetKey } from '@ipc/contracts'
import {
  THEME_PRESETS,
  THEME_PRESET_KEYS,
  THEME_TOKENS,
  FOREGROUND_FLIP,
  foregroundFor,
} from './presets'

describe('theme presets', () => {
  it('matches the allow-list the server validates against', () => {
    // Drift here means a studio could pick a preset the API then rejects, or
    // that the API accepts a key the UI cannot render.
    expect([...THEME_PRESET_KEYS].sort()).toEqual([...themePresetKey.options].sort())
  })

  it('gives every preset a light and a dark value for every token', () => {
    for (const preset of Object.values(THEME_PRESETS)) {
      for (const token of THEME_TOKENS) {
        expect(preset.light[token], `${preset.key} light ${token}`).toBeTruthy()
        expect(preset.dark[token], `${preset.key} dark ${token}`).toBeTruthy()
      }
    }
  })

  it('does not reuse a light colour in dark mode', () => {
    // The whole reason presets are split per scheme: inline tokens outrank the
    // .dark class, so a shared value would drag light colours onto dark surfaces.
    for (const preset of Object.values(THEME_PRESETS)) {
      expect(preset.dark['--primary'], preset.key).not.toBe(preset.light['--primary'])
    }
  })

  it('keeps the focus ring on the accent colour', () => {
    for (const preset of Object.values(THEME_PRESETS)) {
      expect(preset.light['--ring']).toBe(preset.light['--primary'])
      expect(preset.dark['--ring']).toBe(preset.dark['--primary'])
    }
  })

  it('flips the foreground to dark text on light accents', () => {
    // Amber was previously white-on-amber, which failed to read at all.
    expect(foregroundFor({ l: 0.75, c: 0.16, h: 75 })).toContain('oklch(0.2')
    expect(foregroundFor({ l: 0.3, c: 0.06, h: 264 })).toBe('oklch(0.98 0 0)')
  })

  it('flips exactly at the threshold, not around it', () => {
    expect(foregroundFor({ l: FOREGROUND_FLIP, c: 0.1, h: 0 })).toBe('oklch(0.98 0 0)')
    expect(foregroundFor({ l: FOREGROUND_FLIP + 0.01, c: 0.1, h: 0 })).toContain('oklch(0.2')
  })

  it('picks a readable foreground for every preset in both schemes', () => {
    const lightness = (c: string) => Number(/oklch\(([\d.]+)/.exec(c)?.[1] ?? NaN)
    for (const preset of Object.values(THEME_PRESETS)) {
      for (const scheme of ['light', 'dark'] as const) {
        const bg = lightness(preset[scheme]['--primary']!)
        const fg = lightness(preset[scheme]['--primary-foreground']!)
        // Text and its background must be far apart in lightness to be legible.
        expect(Math.abs(bg - fg), `${preset.key} ${scheme}`).toBeGreaterThan(0.28)
      }
    }
  })

  it('offers a real choice of themes', () => {
    expect(THEME_PRESET_KEYS.length).toBeGreaterThanOrEqual(12)
    expect(new Set(THEME_PRESET_KEYS).size).toBe(THEME_PRESET_KEYS.length)
  })

  it('keeps the default preset available', () => {
    expect(THEME_PRESETS.brand).toBeDefined()
  })
})
