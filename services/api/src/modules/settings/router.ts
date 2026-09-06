import { Hono } from 'hono'
import {
  auditLogPage,
  auditLogQuery,
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
import { attempt } from '../../lib/attempt'
import { audit } from '../../lib/audit'

const COMPANY_COLUMNS = ['name', 'legal_name', 'display_name', 'city', 'state', 'country', 'website', 'invoice_gst_number']

export const settingsRouter = new Hono<AppEnv>()
  .use('*', requireAuth)

  .get('/company', async (c) => {
    const auth = c.get('auth')
    const row = await attempt(c, 'settings.company', () =>
      withUser(c.env, auth.userId, async (sql) => {
        const rows = await sql`select ${sql(COMPANY_COLUMNS)} from companies where id = ${auth.companyId}`
        return rows[0] ?? null
      }),
    )
    if (!row) fail(404, 'Company not found.')
    return c.json(companyProfile.parse(row))
  })

  .patch('/company', requireOwner(), async (c) => {
    const parsed = updateCompanyRequest.safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success) fail(422, 'Please check the details.')
    if (Object.keys(parsed.data).length === 0) fail(422, 'Nothing to change.')
    const auth = c.get('auth')
    const result = await attempt(c, 'settings.company_update', () =>
      withUser(c.env, auth.userId, async (sql) => {
        const [before] = await sql`select ${sql(COMPANY_COLUMNS)} from companies where id = ${auth.companyId}`
        const rows = await sql`
          update companies set ${sql(parsed.data)} where id = ${auth.companyId}
          returning ${sql(COMPANY_COLUMNS)}`
        return rows[0] ? { before: before ?? null, after: rows[0] } : null
      }),
    )
    if (!result) fail(400, 'We could not save your changes.')
    await audit(c, {
      action: 'company.update',
      entityType: 'company',
      entityId: auth.companyId,
      before: result.before,
      after: parsed.data,
    })
    return c.json(companyProfile.parse(result.after))
  })

  // Your own row, not the studio's. No owner gate: everyone may edit their own
  // name and phone, and RLS scopes the write to the caller either way.
  .get('/profile', async (c) => {
    const auth = c.get('auth')
    const row = await attempt(c, 'settings.profile', () =>
      withUser(c.env, auth.userId, async (sql) => {
        const rows = await sql`
          select name, email, phone, role, status from users where user_id = ${auth.userId}`
        return rows[0] ?? null
      }),
    )
    if (!row) fail(404, 'We could not load your profile.')
    return c.json(myProfile.parse(row))
  })

  .patch('/profile', async (c) => {
    const parsed = updateMyProfileRequest.safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success) fail(422, 'Please check your details.')
    if (Object.keys(parsed.data).length === 0) fail(422, 'Nothing to change.')
    const auth = c.get('auth')
    const row = await attempt(c, 'settings.profile_update', () =>
      withUser(c.env, auth.userId, async (sql) => {
        const rows = await sql`
          update users set ${sql(parsed.data)} where user_id = ${auth.userId}
          returning name, email, phone, role, status`
        return rows[0] ?? null
      }),
    )
    if (!row) fail(400, 'We could not save your changes.')
    await audit(c, { action: 'profile.update', entityType: 'user', entityId: auth.userId, after: parsed.data })
    return c.json(myProfile.parse(row))
  })

  .get('/theme', async (c) => {
    const auth = c.get('auth')
    const row = await attempt(c, 'settings.theme', () =>
      withUser(c.env, auth.userId, async (sql) => {
        const rows = await sql`
          select preset_key, font_key, color_scheme
          from company_theme_settings where company_id = ${auth.companyId}`
        return rows[0] ?? null
      }),
    )
    return c.json(
      companyTheme.parse(row ?? { preset_key: 'ipc_classic', font_key: null, color_scheme: 'light' }),
    )
  })

  .patch('/theme', requireOwner(), async (c) => {
    const parsed = updateThemeRequest.safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success) fail(422, 'Invalid theme.')
    const auth = c.get('auth')
    const row = await attempt(c, 'settings.theme_update', () =>
      withUser(c.env, auth.userId, async (sql) => {
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
        return rows[0] ?? null
      }),
    )
    if (!row) fail(400, 'We could not save the theme.')
    await audit(c, { action: 'theme.update', entityType: 'company', entityId: auth.companyId, after: parsed.data })
    return c.json(companyTheme.parse(row))
  })

  // ── Audit trail ─────────────────────────────────────────────
  // Owner-only by RLS (audit_logs_select_owner) and by the gate here. Cursor
  // is the created_at of the last row seen; entries are newest first.
  .get('/audit', requireOwner(), async (c) => {
    const parsed = auditLogQuery.safeParse({
      cursor: c.req.query('cursor'),
      limit: c.req.query('limit'),
      entity_type: c.req.query('entity_type'),
    })
    if (!parsed.success) fail(422, 'Invalid query.')
    const { cursor, limit, entity_type } = parsed.data
    const rows = await attempt(c, 'settings.audit', () =>
      withUser(
        c.env,
        c.get('auth').userId,
        (sql) => sql`
          select a.id, a.actor_user_id, u.name as actor_name, a.action, a.entity_type, a.entity_id,
                 a.before, a.after, a.ip, a.correlation_id, a.created_at
          from audit_logs a
          left join users u on u.user_id = a.actor_user_id
          where ${cursor ? sql`a.created_at < ${cursor}` : sql`true`}
            and ${entity_type ? sql`a.entity_type = ${entity_type}` : sql`true`}
          order by a.created_at desc
          limit ${limit + 1}`,
      ),
    )
    if (!rows) fail(400, 'We could not load the audit log.')
    const page = rows.slice(0, limit)
    const last = page[page.length - 1] as { created_at?: string } | undefined
    return c.json(
      auditLogPage.parse({
        items: page,
        next_cursor: rows.length > limit && last?.created_at ? last.created_at : null,
      }),
    )
  })
