import { createContext, use, useCallback, useEffect, useState, type ReactNode } from 'react'
import { THEME_PRESETS, THEME_TOKENS } from './presets'

type Scheme = 'light' | 'dark'

interface ThemeValue {
  scheme: Scheme
  toggleScheme: () => void
  /** Apply an allow-listed preset's tenant tokens (or clear with null). */
  applyPreset: (key: string | null) => void
}

const ThemeCtx = createContext<ThemeValue | null>(null)
const STORAGE_KEY = 'ipc.theme'
const PRESET_KEY = 'ipc.theme.preset'

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [scheme, setScheme] = useState<Scheme>('light')
  // Remembered so a light/dark toggle can re-apply the preset in the other
  // scheme's values — the tokens differ per scheme, so the swap must re-write
  // them rather than leave the light accent sitting on a dark surface.
  const [presetKey, setPresetKey] = useState<string | null>(null)

  useEffect(() => {
    // Default to light; only honour an explicit saved choice (ignore OS scheme).
    const saved = localStorage.getItem(STORAGE_KEY) as Scheme | null
    setScheme(saved ?? 'light')
    // Re-apply the last preset before the settings query resolves, so the accent
    // does not flash the default navy on every page load.
    setPresetKey(localStorage.getItem(PRESET_KEY))
  }, [])

  useEffect(() => {
    document.documentElement.classList.toggle('dark', scheme === 'dark')
  }, [scheme])

  // Write the tokens for whichever scheme is showing. Runs on preset change AND
  // on scheme change, which is what keeps dark mode from inheriting light values.
  useEffect(() => {
    const root = document.documentElement
    for (const token of THEME_TOKENS) root.style.removeProperty(token)
    if (!presetKey) return
    const preset = THEME_PRESETS[presetKey]
    if (!preset) return
    for (const [token, value] of Object.entries(preset[scheme])) {
      root.style.setProperty(token, value)
    }
  }, [presetKey, scheme])

  const toggleScheme = useCallback(() => {
    setScheme((s) => {
      const next = s === 'dark' ? 'light' : 'dark'
      localStorage.setItem(STORAGE_KEY, next)
      return next
    })
  }, [])

  const applyPreset = useCallback((key: string | null) => {
    setPresetKey(key)
    if (key && THEME_PRESETS[key]) localStorage.setItem(PRESET_KEY, key)
    else localStorage.removeItem(PRESET_KEY)
  }, [])

  return <ThemeCtx value={{ scheme, toggleScheme, applyPreset }}>{children}</ThemeCtx>
}

export function useTheme(): ThemeValue {
  const v = use(ThemeCtx)
  if (!v) throw new Error('useTheme must be used within <ThemeProvider>')
  return v
}
