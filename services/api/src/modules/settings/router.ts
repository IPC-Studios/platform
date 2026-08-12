import { Hono } from 'hono'
import { companyProfile, companyTheme, updateCompanyRequest, updateThemeRequest } from '@ipc/contracts'
import type { AppEnv } from '../../context'
import { requireAuth } from '../../middleware/auth'
import { requireOwner } from '../../middleware/permissions'
import { fail } from '../../middleware/errors'
import { withUser } from '../../lib/db'

export const settingsRouter = new Hono<AppEnv>()
  .use('*', requireAuth)

  .get('/company', async (c) => {
    const auth = c.get('auth')
    const row = await withUser(c.env, auth.userId, async (sql) => {
      const rows = await sql`
        select name, legal_name, display_name, city, state, country, website, invoice_gst_number
        from companies where id = ${auth.companyId}`
      return rows[0]
    }).catch(() => null)
    if (!row) fail(404, 'Company not found.')
    return c.json(companyProfile.parse(row))
  })

  .patch('/company', requireOwner(), async (c) => {
    const parsed = updateCompanyRequest.safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success) fail(422, 'Please check the details.')
    const auth = c.get('auth')
    const row = await withUser(c.env, auth.userId, async (sql) => {
      const rows = await sql`
        update companies set ${sql(parsed.data)} where id = ${auth.companyId}
        returning name, legal_name, display_name, city, state, country, website, invoice_gst_number`
      return rows[0]
    }).catch(() => null)
    if (!row) fail(400, 'We could not save your changes.')
    return c.json(companyProfile.parse(row))
  })

  .get('/theme', async (c) => {
    const auth = c.get('auth')
    const row = await withUser(c.env, auth.userId, async (sql) => {
      const rows = await sql`
        select preset_key, color_scheme from company_theme_settings where company_id = ${auth.companyId}`
      return rows[0] ?? null
    }).catch(() => null)
    return c.json(companyTheme.parse(row ?? { preset_key: 'indigo', color_scheme: 'light' }))
  })

  .patch('/theme', requireOwner(), async (c) => {
    const parsed = updateThemeRequest.safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success) fail(422, 'Invalid theme.')
    const auth = c.get('auth')
    const row = await withUser(c.env, auth.userId, async (sql) => {
      const rows = await sql`
        insert into company_theme_settings ${sql({
          company_id: auth.companyId,
          preset_key: parsed.data.preset_key,
          color_scheme: parsed.data.color_scheme,
        })}
        on conflict (company_id) do update
          set preset_key = excluded.preset_key, color_scheme = excluded.color_scheme
        returning preset_key, color_scheme`
      return rows[0]
    }).catch(() => null)
    if (!row) fail(400, 'We could not save the theme.')
    return c.json(companyTheme.parse(row))
  })
