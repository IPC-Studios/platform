import { Hono } from 'hono'
import { createDataRecordRequest, dataRecord, verifyDataRequest } from '@ipc/contracts'
import type { AppEnv } from '../../context'
import { requireAuth } from '../../middleware/auth'
import { requireAction } from '../../middleware/permissions'
import { fail } from '../../middleware/errors'
import { requestClient } from '../../lib/supabase'

const list = dataRecord.array()
const SELECT = 'id,data_label,data_type,primary_status,backup_status,card_count,size_gb,verified_at'

export const dataRouter = new Hono<AppEnv>()
  .use('*', requireAuth)

  .get('/', requireAction('projects', 'view'), async (c) => {
    let q = requestClient(c).from('shoot_data_records').select(SELECT)
    const shoot = c.req.query('shoot_id')
    if (shoot) q = q.eq('shoot_id', shoot)
    const { data, error } = await q.order('created_at', { ascending: false })
    if (error) fail(400, 'We could not load data records.')
    return c.json(list.parse(data ?? []))
  })

  .post('/', requireAction('projects', 'edit'), async (c) => {
    const parsed = createDataRecordRequest.safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success) fail(422, 'Please check the record details.')
    const { data, error } = await requestClient(c)
      .from('shoot_data_records')
      .insert({
        ...parsed.data,
        company_id: c.get('auth').companyId,
        copied_by_uid: c.get('auth').userId,
      })
      .select(SELECT)
      .single()
    if (error || !data) fail(400, 'We could not create the record.')
    return c.json(dataRecord.parse(data), 201)
  })

  .post('/:id/verify', requireAction('projects', 'edit'), async (c) => {
    const parsed = verifyDataRequest.safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success) fail(422, 'Invalid track.')
    const { error } = await requestClient(c).rpc('verify_data_record', {
      p_record_id: c.req.param('id'),
      p_track: parsed.data.track,
    })
    if (error) fail(400, 'We could not verify the record.')
    return c.body(null, 204)
  })
