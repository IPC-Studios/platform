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

export const companyTheme = z.object({
  preset_key: z.string(),
  color_scheme: z.enum(['light', 'dark', 'system']),
})
export type CompanyTheme = z.infer<typeof companyTheme>

export const updateThemeRequest = z.object({
  preset_key: z.string().min(1),
  color_scheme: z.enum(['light', 'dark', 'system']).default('light'),
})
export type UpdateThemeRequest = z.infer<typeof updateThemeRequest>
