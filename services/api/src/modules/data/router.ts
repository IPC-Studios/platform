import { Hono } from 'hono'
import { createDataRecordRequest, dataRecord, verifyDataRequest } from '@ipc/contracts'
import type { AppEnv } from '../../context'
import { requireAuth } from '../../middleware/auth'
import { requireAction } from '../../middleware/permissions'
import { fail } from '../../middleware/errors'
import { uuidParam } from '../../lib/params'
import { withUser } from '../../lib/db'
import { attempt } from '../../lib/attempt'
import { audit } from '../../lib/audit'

const list = dataRecord.array()

export const dataRouter = new Hono<AppEnv>()
  .use('*', requireAuth)

  .get('/', requireAction('projects', 'view'), async (c) => {
    const shoot = c.req.query('shoot_id')
    const rows = await attempt(c, 'data.list', () =>
      withUser(
        c.env,
        c.get('auth').userId,
        (sql) => sql`
          select id, data_label, data_type, primary_status, backup_status, card_count, size_gb, verified_at
          from shoot_data_records
          where ${shoot ? sql`shoot_id = ${shoot}` : sql`true`}
          order by created_at desc`,
      ),
    )
    if (!rows) fail(400, 'We could not load data records.')
    return c.json(list.parse(rows))
  })

  .post('/', requireAction('projects', 'edit'), async (c) => {
    const parsed = createDataRecordRequest.safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success) fail(422, 'Please check the record details.')
    const auth = c.get('auth')
    const row = await attempt(c, 'data.create', () =>
      withUser(c.env, auth.userId, async (sql) => {
        const rows = await sql`
          insert into shoot_data_records ${sql({
            ...parsed.data,
            company_id: auth.companyId,
            copied_by_uid: auth.userId,
          })}
          returning id, data_label, data_type, primary_status, backup_status, card_count, size_gb, verified_at`
        return rows[0] ?? null
      }),
    )
    if (!row) fail(400, 'We could not create the record.')
    const created = dataRecord.parse(row)
    await audit(c, { action: 'data_record.create', entityType: 'shoot_data_record', entityId: created.id, after: parsed.data })
    return c.json(created, 201)
  })

  .post('/:id/verify', requireAction('projects', 'edit'), async (c) => {
    const parsed = verifyDataRequest.safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success) fail(422, 'Invalid track.')
    const id = uuidParam(c)
    const ok = await attempt(c, 'data.verify', () =>
      withUser(c.env, c.get('auth').userId, async (sql) => {
        await sql`select verify_data_record(p_record_id => ${id}, p_track => ${parsed.data.track})`
        return true
      }),
    )
    if (!ok) fail(400, 'We could not verify the record.')
    await audit(c, { action: 'data_record.verify', entityType: 'shoot_data_record', entityId: id, after: parsed.data })
    return c.body(null, 204)
  })
