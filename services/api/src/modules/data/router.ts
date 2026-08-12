import { Hono } from 'hono'
import { createDataRecordRequest, dataRecord, verifyDataRequest } from '@ipc/contracts'
import type { AppEnv } from '../../context'
import { requireAuth } from '../../middleware/auth'
import { requireAction } from '../../middleware/permissions'
import { fail } from '../../middleware/errors'
import { withUser } from '../../lib/db'

const list = dataRecord.array()

export const dataRouter = new Hono<AppEnv>()
  .use('*', requireAuth)

  .get('/', requireAction('projects', 'view'), async (c) => {
    const shoot = c.req.query('shoot_id')
    const rows = await withUser(
      c.env,
      c.get('auth').userId,
      (sql) => sql`
        select id, data_label, data_type, primary_status, backup_status, card_count, size_gb, verified_at
        from shoot_data_records
        where ${shoot ? sql`shoot_id = ${shoot}` : sql`true`}
        order by created_at desc`,
    ).catch(() => null)
    if (!rows) fail(400, 'We could not load data records.')
    return c.json(list.parse(rows))
  })

  .post('/', requireAction('projects', 'edit'), async (c) => {
    const parsed = createDataRecordRequest.safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success) fail(422, 'Please check the record details.')
    const auth = c.get('auth')
    const row = await withUser(c.env, auth.userId, async (sql) => {
      const rows = await sql`
        insert into shoot_data_records ${sql({
          ...parsed.data,
          company_id: auth.companyId,
          copied_by_uid: auth.userId,
        })}
        returning id, data_label, data_type, primary_status, backup_status, card_count, size_gb, verified_at`
      return rows[0]
    }).catch(() => null)
    if (!row) fail(400, 'We could not create the record.')
    return c.json(dataRecord.parse(row), 201)
  })

  .post('/:id/verify', requireAction('projects', 'edit'), async (c) => {
    const parsed = verifyDataRequest.safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success) fail(422, 'Invalid track.')
    const ok = await withUser(c.env, c.get('auth').userId, async (sql) => {
      await sql`select verify_data_record(p_record_id => ${c.req.param('id')!}, p_track => ${parsed.data.track})`
      return true
    }).catch(() => false)
    if (!ok) fail(400, 'We could not verify the record.')
    return c.body(null, 204)
  })
