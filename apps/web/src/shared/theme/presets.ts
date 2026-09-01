import type { ThemeFontKey } from '@ipc/contracts'

/**
 * Theme presets. Each maps to a small set of tenant tokens the ThemeProvider
 * writes onto :root at runtime. Kept as constants (not free-form colour from
 * the client) so a company can only pick from an allow-listed palette — the
 * same list lives in @ipc/contracts, which the server validates writes against.
 *
 * Every preset carries a LIGHT and a DARK value. Runtime tokens land as inline
 * styles on <html>, which outrank the `.dark` class rules — so a single colour
 * per preset would drag its light value into dark mode and wreck the contrast
 * the dark palette was tuned for.
 */
export interface Swatch {
  /** oklch lightness 0–1. */
  l: number
  /** oklch chroma. */
  c: number
  /** oklch hue in degrees. */
  h: number
}

export interface ThemePreset {
  key: string
  label: string
  /** One line on the card — who this palette is for. */
  description: string
  /** The face this theme ships with; a studio can override it. */
  font: ThemeFontKey
  light: Record<string, string>
  dark: Record<string, string>
  /** Colour shown in the picker — the light-mode primary. */
  swatch: string
}

/**
 * Lightness at which white text on the colour stops beating dark text. Below
 * it, white reads better; above, near-black does. Amber and Sunset sit on the
 * far side, which is why a fixed near-white foreground was unreadable on them.
 */
export const FOREGROUND_FLIP = 0.68

/** The readable text colour to sit on top of a given swatch. */
export function foregroundFor({ l, h }: Swatch): string {
  return l > FOREGROUND_FLIP ? `oklch(0.2 0.03 ${h})` : 'oklch(0.98 0 0)'
}

const css = ({ l, c, h }: Swatch) => `oklch(${l} ${c} ${h})`

/**
 * One preset's token set for a single scheme: the accent, the focus ring, the
 * readable text on it, the secondary brand colour, and the tinted neutral that
 * hovers and quiet surfaces sit on.
 *
 * The tint is derived rather than hand-picked so it can never drift off the
 * accent's hue — a "neutral" grey a few degrees off the accent is the thing
 * that makes an interface look subtly broken.
 */
function tokens(accent: Swatch, brand: Swatch, scheme: 'light' | 'dark'): Record<string, string> {
  const tint =
    scheme === 'light'
      ? `oklch(0.965 ${Math.min(accent.c, 0.03)} ${accent.h})`
      : `oklch(0.28 ${Math.min(accent.c, 0.04)} ${accent.h})`
  return {
    '--primary': css(accent),
    '--ring': css(accent),
    '--primary-foreground': foregroundFor(accent),
    '--brand': css(brand),
    // The brand colour is a fill in its own right (nav hovers), so it needs the
    // same readable-text treatment the accent gets.
    '--brand-foreground': foregroundFor(brand),
    '--accent': tint,
    '--accent-foreground': scheme === 'light' ? `oklch(0.25 0.02 ${accent.h})` : 'oklch(0.97 0 0)',
  }
}

interface PresetInput {
  key: string
  label: string
  description: string
  font: ThemeFontKey
  light: Swatch
  dark: Swatch
  /** Secondary colour — logo mark, highlights. Same in both schemes' spirit. */
  brandLight: Swatch
  brandDark: Swatch
}

function preset(p: PresetInput): ThemePreset {
  return {
    key: p.key,
    label: p.label,
    description: p.description,
    font: p.font,
    light: tokens(p.light, p.brandLight, 'light'),
    dark: tokens(p.dark, p.brandDark, 'dark'),
    swatch: css(p.light),
  }
}

/**
 * Dark-mode variants sit lighter and slightly less saturated: the same colour
 * that reads as confident on white turns muddy against a near-black surface.
 */
export const THEME_PRESETS: Readonly<Record<string, ThemePreset>> = Object.fromEntries(
  [
    preset({
      key: 'ipc_classic',
      label: 'IPC Classic',
      description: 'Clean default IPC Studio look.',
      font: 'inter',
      light: { l: 0.52, c: 0.22, h: 274 },
      dark: { l: 0.66, c: 0.18, h: 274 },
      brandLight: { l: 0.78, c: 0.16, h: 70 },
      brandDark: { l: 0.82, c: 0.15, h: 70 },
    }),
    preset({
      key: 'luxury_gold',
      label: 'Luxury Gold',
      description: 'Premium and elegant for luxury wedding brands.',
      font: 'playfair',
      light: { l: 0.28, c: 0.04, h: 265 },
      dark: { l: 0.72, c: 0.05, h: 265 },
      brandLight: { l: 0.72, c: 0.13, h: 90 },
      brandDark: { l: 0.78, c: 0.13, h: 90 },
    }),
    preset({
      key: 'royal_purple',
      label: 'Royal Purple',
      description: 'Modern, premium, and bold.',
      font: 'poppins',
      light: { l: 0.48, c: 0.24, h: 300 },
      dark: { l: 0.66, c: 0.2, h: 300 },
      brandLight: { l: 0.8, c: 0.16, h: 80 },
      brandDark: { l: 0.84, c: 0.15, h: 80 },
    }),
    preset({
      key: 'blush_wedding',
      label: 'Blush Wedding',
      description: 'Soft and elegant for wedding photographers.',
      font: 'lato',
      light: { l: 0.53, c: 0.2, h: 15 },
      dark: { l: 0.68, c: 0.17, h: 15 },
      brandLight: { l: 0.78, c: 0.12, h: 350 },
      brandDark: { l: 0.82, c: 0.11, h: 350 },
    }),
    preset({
      key: 'editorial_black',
      label: 'Editorial Black',
      description: 'Minimal and high-end portfolio style.',
      font: 'manrope',
      light: { l: 0.2, c: 0.005, h: 0 },
      dark: { l: 0.86, c: 0.005, h: 0 },
      brandLight: { l: 0.55, c: 0.01, h: 0 },
      brandDark: { l: 0.7, c: 0.01, h: 0 },
    }),
    preset({
      key: 'ocean_blue',
      label: 'Ocean Blue',
      description: 'Fresh, trustworthy, and clean.',
      font: 'open_sans',
      light: { l: 0.52, c: 0.14, h: 240 },
      dark: { l: 0.68, c: 0.13, h: 240 },
      brandLight: { l: 0.72, c: 0.15, h: 225 },
      brandDark: { l: 0.78, c: 0.13, h: 225 },
    }),
    preset({
      key: 'emerald_studio',
      label: 'Emerald Studio',
      description: 'Calm, premium, and professional.',
      font: 'nunito',
      light: { l: 0.48, c: 0.13, h: 160 },
      dark: { l: 0.68, c: 0.13, h: 160 },
      brandLight: { l: 0.8, c: 0.11, h: 160 },
      brandDark: { l: 0.84, c: 0.1, h: 160 },
    }),
    preset({
      key: 'warm_terracotta',
      label: 'Warm Terracotta',
      description: 'Earthy and artistic for creative studios.',
      font: 'merriweather',
      light: { l: 0.5, c: 0.16, h: 40 },
      dark: { l: 0.67, c: 0.15, h: 40 },
      brandLight: { l: 0.8, c: 0.11, h: 65 },
      brandDark: { l: 0.84, c: 0.1, h: 65 },
    }),
    preset({
      key: 'minimal_slate',
      label: 'Minimal Slate',
      description: 'Simple, neutral, and highly professional.',
      font: 'inter',
      light: { l: 0.38, c: 0.03, h: 255 },
      dark: { l: 0.72, c: 0.03, h: 255 },
      brandLight: { l: 0.68, c: 0.04, h: 255 },
      brandDark: { l: 0.78, c: 0.03, h: 255 },
    }),
  ].map((p) => [p.key, p]),
)

export const THEME_PRESET_KEYS = Object.keys(THEME_PRESETS)

export const DEFAULT_PRESET_KEY = 'ipc_classic'

/**
 * Keys written before the themes were named. The 0027 migration rewrites stored
 * rows, but a client can still be holding one in localStorage — or reading a row
 * written by an API instance that had not rolled over yet.
 */
export const LEGACY_PRESET_ALIASES: Readonly<Record<string, string>> = {
  brand: 'ipc_classic',
  indigo: 'royal_purple',
  emerald: 'emerald_studio',
  amber: 'luxury_gold',
  rose: 'blush_wedding',
}

/** Resolve any stored key — current, legacy or junk — to a preset. */
export function presetFor(key: string | null | undefined): ThemePreset {
  const resolved = LEGACY_PRESET_ALIASES[key ?? ''] ?? key ?? ''
  return THEME_PRESETS[resolved] ?? THEME_PRESETS[DEFAULT_PRESET_KEY]!
}

/** Every token any preset can set — used to wipe the previous one cleanly. */
export const THEME_TOKENS = [
  '--primary',
  '--ring',
  '--primary-foreground',
  '--brand',
  '--brand-foreground',
  '--accent',
  '--accent-foreground',
] as const
