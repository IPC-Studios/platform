import { Hono } from 'hono'
import { createDataRecordRequest, updateDataRecordRequest, dataRecord, verifyDataRequest } from '@ipc/contracts'
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
          select d.id, d.data_label, d.data_type, d.project_id, p.name as project_name, d.shoot_id,
                 d.primary_status, d.backup_status, d.card_count, d.size_gb, d.verified_at
          from shoot_data_records d
          left join projects p on p.id = d.project_id
          where ${shoot ? sql`d.shoot_id = ${shoot}` : sql`true`}
          order by d.created_at desc`,
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
          returning id, data_label, data_type, project_id,
                    (select name from projects where id = project_id) as project_name,
                    shoot_id, primary_status, backup_status, card_count, size_gb, verified_at`
        return rows[0] ?? null
      }),
    )
    if (!row) fail(400, 'We could not create the record.')
    const created = dataRecord.parse(row)
    await audit(c, { action: 'data_record.create', entityType: 'shoot_data_record', entityId: created.id, after: parsed.data })
    return c.json(created, 201)
  })

  .patch('/:id', requireAction('projects', 'edit'), async (c) => {
    const parsed = updateDataRecordRequest.safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success) fail(422, 'Please check the record details.')
    if (Object.keys(parsed.data).length === 0) fail(422, 'Nothing to change.')
    const id = uuidParam(c)
    const row = await attempt(c, 'data.update', () =>
      withUser(c.env, c.get('auth').userId, async (sql) => {
        const rows = await sql`
          update shoot_data_records set ${sql(parsed.data)} where id = ${id}
          returning id, data_label, data_type, project_id,
                    (select name from projects where id = project_id) as project_name,
                    shoot_id, primary_status, backup_status, card_count, size_gb, verified_at`
        return rows[0] ?? null
      }),
    )
    if (!row) fail(404, 'That record was not found.')
    const updated = dataRecord.parse(row)
    await audit(c, { action: 'data_record.update', entityType: 'shoot_data_record', entityId: id, after: parsed.data })
    return c.json(updated)
  })

  // A verified record has already stood in for a real backup being confirmed
  // in hand -- deleting it would erase that custody trail, so only an
  // unverified record (still pending on both tracks) can be removed outright.
  .delete('/:id', requireAction('projects', 'edit'), async (c) => {
    const id = uuidParam(c)
    const rows = await attempt(c, 'data.delete', () =>
      withUser(c.env, c.get('auth').userId, (sql) => sql<{ id: string }[]>`
        delete from shoot_data_records
        where id = ${id} and primary_status = 'pending' and backup_status = 'pending'
        returning id`),
    )
    if (!rows) fail(400, 'We could not delete this record.')
    if (!rows.length) fail(404, 'That record was not found, or already has copies confirmed.')
    await audit(c, { action: 'data_record.delete', entityType: 'shoot_data_record', entityId: id })
    return c.body(null, 204)
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
