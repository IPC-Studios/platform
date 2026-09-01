import { describe, it, expect } from 'vitest'
import { themePresetKey } from '@ipc/contracts'
import {
  DEFAULT_PRESET_KEY,
  LEGACY_PRESET_ALIASES,
  THEME_PRESETS,
  THEME_PRESET_KEYS,
  THEME_TOKENS,
  FOREGROUND_FLIP,
  foregroundFor,
  presetFor,
} from './presets'
import { FONT_OPTIONS } from './fonts'

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
    // The brand colour is a fill too — nav items paint with it on hover — so it
    // needs the same guarantee as the accent. The brands sit light enough that
    // white-on-brand would be the unreadable case.
    for (const preset of Object.values(THEME_PRESETS)) {
      for (const scheme of ['light', 'dark'] as const) {
        for (const fill of ['--primary', '--brand'] as const) {
          const bg = lightness(preset[scheme][fill]!)
          const fg = lightness(preset[scheme][`${fill}-foreground`]!)
          // Text and its background must be far apart in lightness to be legible.
          expect(Math.abs(bg - fg), `${preset.key} ${scheme} ${fill}`).toBeGreaterThan(0.28)
        }
      }
    }
  })

  it('has no duplicate keys', () => {
    expect(new Set(THEME_PRESET_KEYS).size).toBe(THEME_PRESET_KEYS.length)
  })

  it('ships the nine named themes', () => {
    expect([...THEME_PRESET_KEYS].sort()).toEqual([
      'blush_wedding',
      'editorial_black',
      'emerald_studio',
      'ipc_classic',
      'luxury_gold',
      'minimal_slate',
      'ocean_blue',
      'royal_purple',
      'warm_terracotta',
    ])
  })

  it('still resolves the keys studios saved before the themes were named', () => {
    // 0027 rewrites stored rows, but a browser can still be holding an old key
    // in localStorage — and it must not silently become the default palette.
    expect(presetFor('brand').key).toBe('ipc_classic')
    expect(presetFor('indigo').key).toBe('royal_purple')
    expect(presetFor('emerald').key).toBe('emerald_studio')
    expect(presetFor('amber').key).toBe('luxury_gold')
    expect(presetFor('rose').key).toBe('blush_wedding')
    for (const key of Object.keys(LEGACY_PRESET_ALIASES)) {
      expect(THEME_PRESET_KEYS).toContain(presetFor(key).key)
    }
  })

  it('falls back to the default for a key it has never heard of', () => {
    expect(presetFor('sunset').key).toBe(DEFAULT_PRESET_KEY)
    expect(presetFor(null).key).toBe(DEFAULT_PRESET_KEY)
    expect(presetFor(undefined).key).toBe(DEFAULT_PRESET_KEY)
  })

  it('gives every theme a font that exists', () => {
    for (const preset of Object.values(THEME_PRESETS)) {
      expect(FONT_OPTIONS[preset.font], preset.key).toBeTruthy()
    }
  })

  it('describes every theme, so no card ships with an empty line', () => {
    for (const preset of Object.values(THEME_PRESETS)) {
      expect(preset.label.length, preset.key).toBeGreaterThan(2)
      expect(preset.description.length, preset.key).toBeGreaterThan(10)
    }
  })
})
