/**
 * Theme presets. Each maps to a small set of tenant tokens the ThemeProvider
 * writes onto :root at runtime. Kept as constants (not free-form hex from the
 * client) so a company can only pick from an allow-listed palette — the server
 * validates the same list before persisting to company_theme_settings.
 */
export interface ThemePreset {
  key: string
  label: string
  tokens: Record<string, string>
}

export const THEME_PRESETS: Readonly<Record<string, ThemePreset>> = {
  brand: {
    key: 'brand',
    label: 'IPC Navy',
    tokens: { '--primary': 'oklch(0.3 0.06 264)', '--ring': 'oklch(0.3 0.06 264)' },
  },
  indigo: {
    key: 'indigo',
    label: 'Indigo',
    tokens: { '--primary': 'oklch(0.55 0.2 277)', '--ring': 'oklch(0.55 0.2 277)' },
  },
  emerald: {
    key: 'emerald',
    label: 'Emerald',
    tokens: { '--primary': 'oklch(0.6 0.15 160)', '--ring': 'oklch(0.6 0.15 160)' },
  },
  amber: {
    key: 'amber',
    label: 'Amber',
    tokens: { '--primary': 'oklch(0.75 0.16 75)', '--ring': 'oklch(0.75 0.16 75)' },
  },
  rose: {
    key: 'rose',
    label: 'Rose',
    tokens: { '--primary': 'oklch(0.62 0.22 15)', '--ring': 'oklch(0.62 0.22 15)' },
  },
}

export const THEME_PRESET_KEYS = Object.keys(THEME_PRESETS)
