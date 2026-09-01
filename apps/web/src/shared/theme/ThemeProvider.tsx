import { createContext, use, useCallback, useEffect, useState, type ReactNode } from 'react'
import { DEFAULT_PRESET_KEY, THEME_TOKENS, presetFor } from './presets'
import { fontOr, fontStack, loadFont } from './fonts'

type Scheme = 'light' | 'dark'

interface ThemeValue {
  scheme: Scheme
  toggleScheme: () => void
  /** The preset currently painted — saved or previewed. */
  presetKey: string
  /** The font currently painted; null means "the preset's own face". */
  fontKey: string | null
  /**
   * Paint a preset and (optionally) a font. Nothing here persists to the
   * server — the settings page saves separately, so previewing a theme and
   * committing to it stay distinct actions.
   */
  applyTheme: (presetKey: string | null, fontKey?: string | null) => void
}

const ThemeCtx = createContext<ThemeValue | null>(null)
const STORAGE_KEY = 'ipc.theme'
const PRESET_KEY = 'ipc.theme.preset'
const FONT_KEY = 'ipc.theme.font'

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [scheme, setScheme] = useState<Scheme>('light')
  // Remembered so a light/dark toggle can re-apply the preset in the other
  // scheme's values — the tokens differ per scheme, so the swap must re-write
  // them rather than leave the light accent sitting on a dark surface.
  const [presetKey, setPresetKey] = useState<string>(DEFAULT_PRESET_KEY)
  const [fontKey, setFontKey] = useState<string | null>(null)

  useEffect(() => {
    // Default to light; only honour an explicit saved choice (ignore OS scheme).
    const saved = localStorage.getItem(STORAGE_KEY) as Scheme | null
    setScheme(saved ?? 'light')
    // Re-apply the last theme before the settings query resolves, so the accent
    // does not flash the default on every page load.
    setPresetKey(localStorage.getItem(PRESET_KEY) ?? DEFAULT_PRESET_KEY)
    setFontKey(localStorage.getItem(FONT_KEY))
  }, [])

  useEffect(() => {
    document.documentElement.classList.toggle('dark', scheme === 'dark')
  }, [scheme])

  // Write the tokens for whichever scheme is showing. Runs on preset change AND
  // on scheme change, which is what keeps dark mode from inheriting light values.
  useEffect(() => {
    const root = document.documentElement
    for (const token of THEME_TOKENS) root.style.removeProperty(token)
    const preset = presetFor(presetKey)
    for (const [token, value] of Object.entries(preset[scheme])) {
      root.style.setProperty(token, value)
    }
  }, [presetKey, scheme])

  // Typography follows the preset unless a studio has picked its own face.
  useEffect(() => {
    const font = fontOr(fontKey, presetFor(presetKey).font)
    loadFont(font)
    document.documentElement.style.setProperty('--font-sans', fontStack(font))
  }, [presetKey, fontKey])

  const toggleScheme = useCallback(() => {
    setScheme((s) => {
      const next = s === 'dark' ? 'light' : 'dark'
      localStorage.setItem(STORAGE_KEY, next)
      return next
    })
  }, [])

  const applyTheme = useCallback((key: string | null, font?: string | null) => {
    const resolved = key ?? DEFAULT_PRESET_KEY
    setPresetKey(resolved)
    localStorage.setItem(PRESET_KEY, resolved)
    if (font === undefined) return
    setFontKey(font)
    if (font) localStorage.setItem(FONT_KEY, font)
    else localStorage.removeItem(FONT_KEY)
  }, [])

  return (
    <ThemeCtx value={{ scheme, toggleScheme, presetKey, fontKey, applyTheme }}>{children}</ThemeCtx>
  )
}

export function useTheme(): ThemeValue {
  const v = use(ThemeCtx)
  if (!v) throw new Error('useTheme must be used within <ThemeProvider>')
  return v
}
