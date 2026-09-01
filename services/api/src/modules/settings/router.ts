import { Hono } from 'hono'
import {
  companyProfile,
  companyTheme,
  myProfile,
  updateCompanyRequest,
  updateMyProfileRequest,
  updateThemeRequest,
} from '@ipc/contracts'
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

  // Your own row, not the studio's. No owner gate: everyone may edit their own
  // name and phone, and RLS scopes the write to the caller either way.
  .get('/profile', async (c) => {
    const auth = c.get('auth')
    const row = await withUser(c.env, auth.userId, async (sql) => {
      const rows = await sql`
        select name, email, phone, role, status from users where user_id = ${auth.userId}`
      return rows[0]
    }).catch(() => null)
    if (!row) fail(404, 'We could not load your profile.')
    return c.json(myProfile.parse(row))
  })

  .patch('/profile', async (c) => {
    const parsed = updateMyProfileRequest.safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success) fail(422, 'Please check your details.')
    if (Object.keys(parsed.data).length === 0) fail(422, 'Nothing to change.')
    const auth = c.get('auth')
    const row = await withUser(c.env, auth.userId, async (sql) => {
      const rows = await sql`
        update users set ${sql(parsed.data)} where user_id = ${auth.userId}
        returning name, email, phone, role, status`
      return rows[0]
    }).catch(() => null)
    if (!row) fail(400, 'We could not save your changes.')
    return c.json(myProfile.parse(row))
  })

  .get('/theme', async (c) => {
    const auth = c.get('auth')
    const row = await withUser(c.env, auth.userId, async (sql) => {
      const rows = await sql`
        select preset_key, font_key, color_scheme
        from company_theme_settings where company_id = ${auth.companyId}`
      return rows[0] ?? null
    }).catch(() => null)
    return c.json(
      companyTheme.parse(row ?? { preset_key: 'ipc_classic', font_key: null, color_scheme: 'light' }),
    )
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
          // null is a real value here: it hands typography back to the theme.
          font_key: parsed.data.font_key ?? null,
          color_scheme: parsed.data.color_scheme,
        })}
        on conflict (company_id) do update
          set preset_key   = excluded.preset_key,
              font_key     = excluded.font_key,
              color_scheme = excluded.color_scheme
        returning preset_key, font_key, color_scheme`
      return rows[0]
    }).catch(() => null)
    if (!row) fail(400, 'We could not save the theme.')
    return c.json(companyTheme.parse(row))
  })
