import { createContext, use, useCallback, useEffect, useState, type ReactNode } from 'react'
import { THEME_PRESETS } from './presets'

type Scheme = 'light' | 'dark'

interface ThemeValue {
  scheme: Scheme
  toggleScheme: () => void
  /** Apply an allow-listed preset's tenant tokens (or clear with null). */
  applyPreset: (key: string | null) => void
}

const ThemeCtx = createContext<ThemeValue | null>(null)
const STORAGE_KEY = 'ipc.theme'

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [scheme, setScheme] = useState<Scheme>('light')

  useEffect(() => {
    // Default to light; only honour an explicit saved choice (ignore OS scheme).
    const saved = localStorage.getItem(STORAGE_KEY) as Scheme | null
    setScheme(saved ?? 'light')
  }, [])

  useEffect(() => {
    document.documentElement.classList.toggle('dark', scheme === 'dark')
  }, [scheme])

  const toggleScheme = useCallback(() => {
    setScheme((s) => {
      const next = s === 'dark' ? 'light' : 'dark'
      localStorage.setItem(STORAGE_KEY, next)
      return next
    })
  }, [])

  const applyPreset = useCallback((key: string | null) => {
    const root = document.documentElement
    // Clear any previously applied preset tokens.
    for (const preset of Object.values(THEME_PRESETS)) {
      for (const token of Object.keys(preset.tokens)) root.style.removeProperty(token)
    }
    if (!key) return
    const preset = THEME_PRESETS[key]
    if (!preset) return
    for (const [token, value] of Object.entries(preset.tokens)) root.style.setProperty(token, value)
  }, [])

  return <ThemeCtx value={{ scheme, toggleScheme, applyPreset }}>{children}</ThemeCtx>
}

export function useTheme(): ThemeValue {
  const v = use(ThemeCtx)
  if (!v) throw new Error('useTheme must be used within <ThemeProvider>')
  return v
}
