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

/** One preset's token set: the accent, the focus ring, and readable text on it. */
function tokens(s: Swatch): Record<string, string> {
  return {
    '--primary': css(s),
    '--ring': css(s),
    '--primary-foreground': foregroundFor(s),
  }
}

function preset(key: string, label: string, light: Swatch, dark: Swatch): ThemePreset {
  return { key, label, light: tokens(light), dark: tokens(dark), swatch: css(light) }
}

/**
 * Dark-mode variants sit lighter and slightly less saturated: the same colour
 * that reads as confident on white turns muddy against a near-black surface.
 */
export const THEME_PRESETS: Readonly<Record<string, ThemePreset>> = Object.fromEntries(
  [
    preset('brand', 'IPC Navy', { l: 0.3, c: 0.06, h: 264 }, { l: 0.5, c: 0.1, h: 264 }),
    preset('indigo', 'Indigo', { l: 0.55, c: 0.2, h: 277 }, { l: 0.66, c: 0.18, h: 277 }),
    preset('emerald', 'Emerald', { l: 0.6, c: 0.15, h: 160 }, { l: 0.7, c: 0.14, h: 160 }),
    preset('amber', 'Amber', { l: 0.75, c: 0.16, h: 75 }, { l: 0.8, c: 0.15, h: 75 }),
    preset('rose', 'Rose', { l: 0.62, c: 0.22, h: 15 }, { l: 0.7, c: 0.19, h: 15 }),
  ].map((p) => [p.key, p]),
)

export const THEME_PRESET_KEYS = Object.keys(THEME_PRESETS)

/** Every token any preset can set — used to wipe the previous one cleanly. */
export const THEME_TOKENS = ['--primary', '--ring', '--primary-foreground'] as const
