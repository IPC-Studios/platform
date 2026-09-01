import { z } from 'zod'

export const companyProfile = z.object({
  name: z.string(),
  legal_name: z.string().nullable(),
  display_name: z.string().nullable(),
  city: z.string().nullable(),
  state: z.string().nullable(),
  country: z.string().nullable(),
  website: z.string().nullable(),
  invoice_gst_number: z.string().nullable(),
})
export type CompanyProfile = z.infer<typeof companyProfile>

export const updateCompanyRequest = z.object({
  name: z.string().trim().min(2).max(120).optional(),
  legal_name: z.string().trim().max(160).optional(),
  display_name: z.string().trim().max(120).optional(),
  city: z.string().trim().max(120).optional(),
  state: z.string().trim().max(120).optional(),
  country: z.string().trim().max(80).optional(),
  website: z.string().trim().max(200).optional(),
  invoice_gst_number: z.string().trim().max(20).optional(),
})
export type UpdateCompanyRequest = z.infer<typeof updateCompanyRequest>

/**
 * The allow-listed theme presets. The palette itself lives in the web app; this
 * is the shared key list so the server can refuse a preset that does not exist
 * instead of persisting arbitrary strings into company_theme_settings.
 */
export const themePresetKey = z.enum([
  'ipc_classic',
  'luxury_gold',
  'royal_purple',
  'blush_wedding',
  'editorial_black',
  'ocean_blue',
  'emerald_studio',
  'warm_terracotta',
  'minimal_slate',
])
export type ThemePresetKey = z.infer<typeof themePresetKey>

/**
 * Typography is chosen separately from colour: every preset ships with a
 * matching face, but a studio can keep the palette and swap the font.
 */
export const themeFontKey = z.enum([
  'inter',
  'playfair',
  'poppins',
  'lato',
  'manrope',
  'open_sans',
  'nunito',
  'merriweather',
])
export type ThemeFontKey = z.infer<typeof themeFontKey>

export const companyTheme = z.object({
  // Tolerant on READ: a row written before a preset was renamed or retired must
  // still load — the UI falls back to the default rather than erroring the page.
  preset_key: z.string(),
  font_key: z.string().nullable(),
  color_scheme: z.enum(['light', 'dark', 'system']),
})
export type CompanyTheme = z.infer<typeof companyTheme>

export const updateThemeRequest = z.object({
  // Strict on WRITE: only a real preset gets stored.
  preset_key: themePresetKey,
  // Absent means "whatever the preset ships with", which is what the theme
  // cards send; the font picker sends an explicit key.
  font_key: themeFontKey.nullish(),
  color_scheme: z.enum(['light', 'dark', 'system']).default('light'),
})
export type UpdateThemeRequest = z.infer<typeof updateThemeRequest>
