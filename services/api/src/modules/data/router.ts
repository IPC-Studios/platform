import { Hono } from 'hono'
import {
  createDataRecordRequest,
  updateDataRecordRequest,
  dataRecord,
  verifyDataRequest,
  storageLocation,
  createStorageLocationRequest,
  updateStorageLocationRequest,
} from '@ipc/contracts'
import type { AppEnv } from '../../context'
import { requireAuth } from '../../middleware/auth'
import { requireAction } from '../../middleware/permissions'
import { fail } from '../../middleware/errors'
import { uuidParam, uuidQuery } from '../../lib/params'
import { withUser } from '../../lib/db'
import { attempt } from '../../lib/attempt'
import { audit } from '../../lib/audit'

const list = dataRecord.array()
const locationList = storageLocation.array()

export const dataRouter = new Hono<AppEnv>()
  .use('*', requireAuth)

  .get('/', requireAction('projects', 'view'), async (c) => {
    const shoot = c.req.query('shoot_id')
    const project = uuidQuery(c, 'project_id')
    const rows = await attempt(c, 'data.list', () =>
      withUser(
        c.env,
        c.get('auth').userId,
        (sql) => sql`
          select d.id, d.data_label, d.data_type, d.project_id, p.name as project_name, d.shoot_id,
                 d.primary_status, d.backup_status,
                 d.primary_location_id, pl.name as primary_location_name,
                 d.backup_location_id, bl.name as backup_location_name,
                 d.card_count, d.size_gb, d.verified_at, d.created_at
          from shoot_data_records d
          left join projects p on p.id = d.project_id
          left join storage_locations pl on pl.id = d.primary_location_id
          left join storage_locations bl on bl.id = d.backup_location_id
          where ${shoot ? sql`d.shoot_id = ${shoot}` : sql`true`}
            and ${project ? sql`d.project_id = ${project}` : sql`true`}
          order by d.created_at desc`,
      ),
    )
    if (!rows) fail(400, 'We could not load data records.')
    return c.json(list.parse(rows))
  })

  .get('/locations', requireAction('projects', 'view'), async (c) => {
    const rows = await attempt(c, 'data.locations.list', () =>
      withUser(
        c.env,
        c.get('auth').userId,
        (sql) => sql`select id, name, kind from storage_locations order by name`,
      ),
    )
    if (!rows) fail(400, 'We could not load storage locations.')
    return c.json(locationList.parse(rows))
  })

  .post('/locations', requireAction('projects', 'edit'), async (c) => {
    const parsed = createStorageLocationRequest.safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success) fail(422, 'Please check the location details.')
    const auth = c.get('auth')
    const row = await attempt(c, 'data.locations.create', () =>
      withUser(c.env, auth.userId, async (sql) => {
        const rows = await sql`
          insert into storage_locations ${sql({ ...parsed.data, company_id: auth.companyId })}
          returning id, name, kind`
        return rows[0] ?? null
      }),
    )
    if (!row) fail(400, 'A location with that name may already exist.')
    const created = storageLocation.parse(row)
    await audit(c, { action: 'storage_location.create', entityType: 'storage_location', entityId: created.id, after: parsed.data })
    return c.json(created, 201)
  })

  .patch('/locations/:id', requireAction('projects', 'edit'), async (c) => {
    const parsed = updateStorageLocationRequest.safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success) fail(422, 'Please check the location details.')
    if (Object.keys(parsed.data).length === 0) fail(422, 'Nothing to change.')
    const id = uuidParam(c)
    const row = await attempt(c, 'data.locations.update', () =>
      withUser(c.env, c.get('auth').userId, async (sql) => {
        const rows = await sql`
          update storage_locations set ${sql(parsed.data)} where id = ${id}
          returning id, name, kind`
        return rows[0] ?? null
      }),
    )
    if (!row) fail(404, 'That location was not found.')
    const updated = storageLocation.parse(row)
    await audit(c, { action: 'storage_location.update', entityType: 'storage_location', entityId: id, after: parsed.data })
    return c.json(updated)
  })

  .delete('/locations/:id', requireAction('projects', 'edit'), async (c) => {
    const id = uuidParam(c)
    const rows = await attempt(c, 'data.locations.delete', () =>
      withUser(c.env, c.get('auth').userId, (sql) => sql<{ id: string }[]>`
        delete from storage_locations where id = ${id} returning id`),
    )
    if (!rows) fail(400, 'We could not delete this location.')
    if (!rows.length) fail(404, 'That location was not found.')
    await audit(c, { action: 'storage_location.delete', entityType: 'storage_location', entityId: id })
    return c.body(null, 204)
  })

  .post('/', requireAction('projects', 'edit'), async (c) => {
    const parsed = createDataRecordRequest.safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success) fail(422, 'Please check the record details.')
    const auth = c.get('auth')
    const row = await attempt(c, 'data.create', () =>
      withUser(c.env, auth.userId, async (sql) => {
        const inserted = await sql<{ id: string }[]>`
          insert into shoot_data_records ${sql({
            ...parsed.data,
            company_id: auth.companyId,
            copied_by_uid: auth.userId,
          })}
          returning id`
        if (!inserted[0]) return null
        const rows = await sql`
          select d.id, d.data_label, d.data_type, d.project_id,
                 (select name from projects where id = d.project_id) as project_name,
                 d.shoot_id, d.primary_status, d.backup_status,
                 d.primary_location_id, pl.name as primary_location_name,
                 d.backup_location_id, bl.name as backup_location_name,
                 d.card_count, d.size_gb, d.verified_at, d.created_at
          from shoot_data_records d
          left join storage_locations pl on pl.id = d.primary_location_id
          left join storage_locations bl on bl.id = d.backup_location_id
          where d.id = ${inserted[0].id}`
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
        await sql`update shoot_data_records set ${sql(parsed.data)} where id = ${id}`
        const rows = await sql`
          select d.id, d.data_label, d.data_type, d.project_id,
                 (select name from projects where id = d.project_id) as project_name,
                 d.shoot_id, d.primary_status, d.backup_status,
                 d.primary_location_id, pl.name as primary_location_name,
                 d.backup_location_id, bl.name as backup_location_name,
                 d.card_count, d.size_gb, d.verified_at, d.created_at
          from shoot_data_records d
          left join storage_locations pl on pl.id = d.primary_location_id
          left join storage_locations bl on bl.id = d.backup_location_id
          where d.id = ${id}`
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
