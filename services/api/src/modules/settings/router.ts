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

const COMPANY_COLUMNS = [
  'name',
  'legal_name',
  'display_name',
  'city',
  'state',
  'country',
  'website',
  'invoice_gst_number',
  'avatar_url',
  'invoice_number_prefix',
  'invoice_next_number',
  'quote_number_prefix',
  'quote_next_number',
]

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
          select preset_key, font_key, color_scheme, custom_color, border_radius
          from company_theme_settings where company_id = ${auth.companyId}`
        return rows[0] ?? null
      }),
    )
    return c.json(
      companyTheme.parse(row ?? { preset_key: 'ipc_classic', font_key: null, color_scheme: 'light', custom_color: null, border_radius: '0.5' }),
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
            font_key: parsed.data.font_key ?? null,
            color_scheme: parsed.data.color_scheme,
            custom_color: parsed.data.custom_color ?? null,
            border_radius: parsed.data.border_radius ?? '0.5',
          })}
          on conflict (company_id) do update
            set preset_key    = excluded.preset_key,
                font_key      = excluded.font_key,
                color_scheme  = excluded.color_scheme,
                custom_color  = excluded.custom_color,
                border_radius = excluded.border_radius
          returning preset_key, font_key, color_scheme, custom_color, border_radius`
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

  // ── Custom Lookups ─────────────────────────────────────────
  .get('/lookups', requireOwner(), async (c) => {
    const category = c.req.query('category')
    const rows = await attempt(c, 'settings.lookups', () =>
      withUser(c.env, c.get('auth').userId, async (sql) => {
        return sql`
          select id, category, value, sort_order, is_active
            from custom_lookups
           where company_id = ${c.get('auth').companyId}
             and ${category ? sql`category = ${category}` : sql`true`}
           order by category, sort_order, value`
      }),
    )
    if (!rows) fail(400, 'We could not load lookups.')
    return c.json(rows)
  })

  .post('/lookups', requireOwner(), async (c) => {
    const body = await c.req.json().catch(() => ({}))
    const category = typeof body.category === 'string' ? body.category.trim() : ''
    const value = typeof body.value === 'string' ? body.value.trim() : ''
    if (!category || !value) fail(422, 'Category and value are required.')
    const auth = c.get('auth')
    const rows = await attempt(c, 'settings.lookup_create', () =>
      withUser(c.env, auth.userId, async (sql) => {
        const made = await sql<{ id: string }[]>`
          insert into custom_lookups (company_id, category, value, sort_order)
          values (${auth.companyId}, ${category}, ${value}, ${body.sort_order ?? 0})
          on conflict (company_id, category, value) do nothing
          returning id`
        return made
      }),
    )
    if (!rows?.[0]) fail(409, 'That lookup value already exists.')
    await audit(c, { action: 'lookup.create', entityType: 'custom_lookup', entityId: rows[0].id, after: { category, value } })
    return c.json({ id: rows[0].id }, 201)
  })

  .patch('/lookups/:id', requireOwner(), async (c) => {
    const id = c.req.param('id')
    if (!id) fail(422, 'ID is required.')
    const body = await c.req.json().catch(() => ({}))
    const patch: Record<string, unknown> = {}
    if (typeof body.value === 'string' && body.value.trim()) patch.value = body.value.trim()
    if (typeof body.sort_order === 'number') patch.sort_order = body.sort_order
    if (typeof body.is_active === 'boolean') patch.is_active = body.is_active
    if (Object.keys(patch).length === 0) fail(422, 'Nothing to change.')
    const auth = c.get('auth')
    const rows = await attempt(
      c,
      'settings.lookup_update',
      () =>
        withUser(c.env, auth.userId, (sql) => sql<{ id: string }[]>`
          update custom_lookups set ${sql(patch)} where id = ${id} and company_id = ${auth.companyId} returning id`),
      { onCode: (code) => (code === '23505' ? 'taken' : undefined) },
    )
    if (rows === 'taken') fail(409, 'That value already exists in this category.')
    if (!rows) fail(400, 'We could not update this lookup.')
    if (!rows.length) fail(404, 'We could not find that lookup.')
    await audit(c, { action: 'lookup.update', entityType: 'custom_lookup', entityId: id, after: patch })
    return c.json({ ok: true })
  })

  .delete('/lookups/:id', requireOwner(), async (c) => {
    const id = c.req.param('id')
    if (!id) fail(422, 'ID is required.')
    const auth = c.get('auth')
    const rows = await attempt(c, 'settings.lookup_delete', () =>
      withUser(c.env, auth.userId, async (sql) => {
        return sql<{ id: string }[]>`
          delete from custom_lookups where id = ${id} and company_id = ${auth.companyId} returning id`
      }),
    )
    if (!rows) fail(400, 'We could not delete this lookup.')
    if (!rows.length) fail(404, 'We could not find that lookup.')
    await audit(c, { action: 'lookup.delete', entityType: 'custom_lookup', entityId: id })
    return c.json({ ok: true })
  })
