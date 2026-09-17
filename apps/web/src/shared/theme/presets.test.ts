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

  it('ships the ten named themes', () => {
    expect([...THEME_PRESET_KEYS].sort()).toEqual([
      'blush_wedding',
      'editorial_black',
      'emerald_studio',
      'ipc_classic',
      'luxury_gold',
      'minimal_slate',
      'ocean_blue',
      'premium_rose_gold',
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

/**
 * A theme has to LOOK like the thing it is called.
 *
 * "Luxury Gold" shipped as `{ l: 0.28, c: 0.04, h: 265 }` — a desaturated navy
 * nine degrees of hue from IPC Classic, with the actual gold parked in
 * `--brand`, a token roughly 11 places in the app paint against versus ~271
 * for `--primary`. Applying it changed the interface so little that it was
 * reported as "the apply theme button is not working". The button was fine.
 *
 * Every assertion below is about that failure: a preset must be saturated
 * enough to read as a colour, must sit in the hue band its name promises, and
 * must not be a near-duplicate of another preset. The deliberately neutral
 * ones are named, so making a theme grey stays a decision somebody wrote down
 * rather than a value that drifted.
 */
describe('a preset looks like its name', () => {
  /** oklch -> oklab, so hue and chroma can be compared as a distance. */
  const oklab = (swatch: { l: number; c: number; h: number }) => ({
    l: swatch.l,
    a: swatch.c * Math.cos((swatch.h * Math.PI) / 180),
    b: swatch.c * Math.sin((swatch.h * Math.PI) / 180),
  })

  const parse = (token: string | undefined) => {
    const m = /oklch\(([\d.]+) ([\d.]+) ([\d.]+)\)/.exec(token ?? '')
    if (!m) throw new Error(`not an oklch token: ${token}`)
    return { l: Number(m[1]), c: Number(m[2]), h: Number(m[3]) }
  }

  /** Presets that are grey ON PURPOSE. Anything else must carry colour. */
  const DELIBERATELY_NEUTRAL = new Set(['editorial_black', 'minimal_slate'])

  /** What each name promises, as an inclusive oklch hue range in degrees. */
  const HUE_PROMISES: Record<string, [number, number]> = {
    luxury_gold: [70, 105],
    royal_purple: [280, 330],
    blush_wedding: [345, 30],
    ocean_blue: [220, 265],
    emerald_studio: [140, 180],
    warm_terracotta: [20, 60],
    premium_rose_gold: [330, 20],
  }

  const inBand = (h: number, [lo, hi]: [number, number]) =>
    lo <= hi ? h >= lo && h <= hi : h >= lo || h <= hi

  it('gives every colourful preset enough chroma to read as a colour', () => {
    for (const preset of Object.values(THEME_PRESETS)) {
      if (DELIBERATELY_NEUTRAL.has(preset.key)) continue
      const { c } = parse(preset.light['--primary'])
      // Below roughly 0.08 a colour stops reading as a hue and starts reading
      // as "slightly tinted grey", which is indistinguishable from the theme
      // the studio is switching away from.
      expect(c, `${preset.key} light primary chroma`).toBeGreaterThanOrEqual(0.08)
    }
  })

  it('puts every named colour in the hue band its name promises', () => {
    for (const [key, band] of Object.entries(HUE_PROMISES)) {
      const { h } = parse(THEME_PRESETS[key]?.light['--primary'])
      expect(inBand(h, band), `${key} light primary hue ${h} outside ${band.join('..')}`).toBe(true)
    }
  })

  it('keeps the deliberately neutral presets neutral', () => {
    // The other half of the rule: if a theme IS meant to be grey, it should
    // not quietly acquire a colour either.
    for (const key of DELIBERATELY_NEUTRAL) {
      const { c } = parse(THEME_PRESETS[key]?.light['--primary'])
      expect(c, `${key} is meant to be neutral`).toBeLessThan(0.08)
    }
  })

  it('makes every pair of presets visibly different from each other', () => {
    const entries = Object.values(THEME_PRESETS)
    for (let i = 0; i < entries.length; i++) {
      for (let j = i + 1; j < entries.length; j++) {
        const a = oklab(parse(entries[i]!.light['--primary']))
        const b = oklab(parse(entries[j]!.light['--primary']))
        const d = Math.hypot(a.l - b.l, a.a - b.a, a.b - b.b)
        // Two presets closer than this look like the same theme, and applying
        // one over the other looks like nothing happened.
        expect(d, `${entries[i]!.key} vs ${entries[j]!.key} (distance ${d.toFixed(3)})`).toBeGreaterThan(0.1)
      }
    }
  })

  it('picks readable text for every preset, including the light ones', () => {
    // Gold and terracotta sit above FOREGROUND_FLIP, so they take dark text.
    // A fixed near-white foreground on them is the unreadable case this guards.
    for (const preset of Object.values(THEME_PRESETS)) {
      const bg = parse(preset.light['--primary'])
      const fg = parse(preset.light['--primary-foreground'])
      expect(Math.abs(bg.l - fg.l), `${preset.key} text contrast`).toBeGreaterThan(0.4)
    }
  })
})
