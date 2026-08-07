import { Hono } from 'hono'
import { companyProfile, companyTheme, updateCompanyRequest, updateThemeRequest } from '@ipc/contracts'
import type { AppEnv } from '../../context'
import { requireAuth } from '../../middleware/auth'
import { requireOwner } from '../../middleware/permissions'
import { fail } from '../../middleware/errors'
import { requestClient } from '../../lib/supabase'

const PROFILE = 'name,legal_name,display_name,city,state,country,website,invoice_gst_number'

export const settingsRouter = new Hono<AppEnv>()
  .use('*', requireAuth)

  .get('/company', async (c) => {
    const { data, error } = await requestClient(c)
      .from('companies')
      .select(PROFILE)
      .eq('id', c.get('auth').companyId)
      .single()
    if (error || !data) fail(404, 'Company not found.')
    return c.json(companyProfile.parse(data))
  })

  .patch('/company', requireOwner(), async (c) => {
    const parsed = updateCompanyRequest.safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success) fail(422, 'Please check the details.')
    const { data, error } = await requestClient(c)
      .from('companies')
      .update(parsed.data)
      .eq('id', c.get('auth').companyId)
      .select(PROFILE)
      .single()
    if (error || !data) fail(400, 'We could not save your changes.')
    return c.json(companyProfile.parse(data))
  })

  .get('/theme', async (c) => {
    const { data } = await requestClient(c)
      .from('company_theme_settings')
      .select('preset_key,color_scheme')
      .eq('company_id', c.get('auth').companyId)
      .maybeSingle()
    return c.json(companyTheme.parse(data ?? { preset_key: 'indigo', color_scheme: 'light' }))
  })

  .patch('/theme', requireOwner(), async (c) => {
    const parsed = updateThemeRequest.safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success) fail(422, 'Invalid theme.')
    const { data, error } = await requestClient(c)
      .from('company_theme_settings')
      .upsert(
        {
          company_id: c.get('auth').companyId,
          preset_key: parsed.data.preset_key,
          color_scheme: parsed.data.color_scheme,
        },
        { onConflict: 'company_id' },
      )
      .select('preset_key,color_scheme')
      .single()
    if (error || !data) fail(400, 'We could not save the theme.')
    return c.json(companyTheme.parse(data))
  })
