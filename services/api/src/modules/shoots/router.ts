import { Hono } from 'hono'
import {
  createShootRequest,
  saveShootPresetRequest,
  serviceOption,
  shootListItem,
  shootPreset,
  shootPresetKind,
  updateShootRequest,
  type ShootRequirementInput,
} from '@ipc/contracts'
import type { AppEnv } from '../../context'
import { requireAuth } from '../../middleware/auth'
import { requireAction } from '../../middleware/permissions'
import { fail } from '../../middleware/errors'
import { withUser } from '../../lib/db'
import type { TransactionSql } from 'postgres'

const list = shootListItem.array()
const services = serviceOption.array()
const presets = shootPreset.array()

/**
 * Attach "who and what this day needs" to a shoot.
 *
 * Requirements arrive by name, not by id: the picker lets a studio type
 * "Drone pilot" the first time it books one. The service row is upserted on
 * the way past, which is why there is no services admin screen to visit first
 * — the list on the picker is simply what this company has asked for before.
 */
async function saveRequirements(
  sql: TransactionSql,
  companyId: string,
  shootId: string,
  requirements: ShootRequirementInput[],
) {
  for (const r of requirements) {
    const name = r.name.trim()
    if (!name) continue
    // do update, not do nothing: `returning` is empty on a skipped insert, and
    // the id is the whole point of the round trip.
    const svc = await sql<{ id: string }[]>`
      insert into services (company_id, name) values (${companyId}, ${name})
      on conflict (company_id, name) do update set name = excluded.name
      returning id`
    await sql`
      insert into shoot_services ${sql({
        company_id: companyId,
        shoot_id: shootId,
        service_id: svc[0]!.id,
        quantity: r.quantity,
      })}`
  }
}

export const shootsRouter = new Hono<AppEnv>()
  .use('*', requireAuth)

  .get('/', requireAction('projects', 'view'), async (c) => {
    const project = c.req.query('project_id')
    const rows = await withUser(
      c.env,
      c.get('auth').userId,
      (sql) => sql`
        select s.id, s.name, s.project_id, s.shoot_date, s.location, s.status,
               p.name as project_name
        from shoots s
        left join projects p on p.id = s.project_id
        where ${project ? sql`s.project_id = ${project}` : sql`true`}
        order by s.shoot_date asc nulls last`,
    ).catch(() => null)
    if (!rows) fail(400, 'We could not load shoots.')
    return c.json(list.parse(rows))
  })

  // Declared above /:id-shaped routes so "services" is never read as an id.
  .get('/services', requireAction('projects', 'view'), async (c) => {
    const rows = await withUser(
      c.env,
      c.get('auth').userId,
      (sql) => sql`select id, name from services order by name asc`,
    ).catch(() => null)
    if (!rows) fail(400, 'We could not load services.')
    return c.json(services.parse(rows))
  })

  .get('/presets', requireAction('projects', 'view'), async (c) => {
    const kind = shootPresetKind.safeParse(c.req.query('kind'))
    const rows = await withUser(
      c.env,
      c.get('auth').userId,
      (sql) => sql`
        select id, kind, name, payload from shoot_presets
        where ${kind.success ? sql`kind = ${kind.data}` : sql`true`}
        order by name asc`,
    ).catch(() => null)
    if (!rows) fail(400, 'We could not load presets.')
    return c.json(presets.parse(rows))
  })

  .post('/presets', requireAction('projects', 'edit'), async (c) => {
    const parsed = saveShootPresetRequest.safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success) fail(422, 'Please name the preset.')
    const auth = c.get('auth')
    const row = await withUser(c.env, auth.userId, async (sql) => {
      // Saving over a name that exists is what "save preset" means to the
      // person pressing it — not a second entry with the same label.
      const rows = await sql`
        insert into shoot_presets ${sql({
          company_id: auth.companyId,
          kind: parsed.data.kind,
          name: parsed.data.name,
          payload: sql.json(parsed.data.payload),
        })}
        on conflict (company_id, kind, name) do update set payload = excluded.payload
        returning id, kind, name, payload`
      return rows[0]
    }).catch(() => null)
    if (!row) fail(400, 'We could not save the preset.')
    return c.json(shootPreset.parse(row), 201)
  })

  .delete('/presets/:id', requireAction('projects', 'edit'), async (c) => {
    const ok = await withUser(c.env, c.get('auth').userId, async (sql) => {
      await sql`delete from shoot_presets where id = ${c.req.param('id')!}`
      return true
    }).catch(() => false)
    if (!ok) fail(400, 'We could not delete the preset.')
    return c.body(null, 204)
  })

  .post('/', requireAction('projects', 'edit'), async (c) => {
    const parsed = createShootRequest.safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success) fail(422, 'Please check the shoot details.')
    const auth = c.get('auth')
    // Requirements live in their own table, so they must come off the row
    // before it is spread into the insert.
    const { requirements = [], ...fields } = parsed.data
    const row = await withUser(c.env, auth.userId, async (sql) => {
      const rows = await sql<{ id: string }[]>`
        insert into shoots ${sql({ ...fields, company_id: auth.companyId })} returning id`
      const shoot = rows[0]!
      await saveRequirements(sql, auth.companyId, shoot.id, requirements)
      return shoot
    }).catch(() => null)
    if (!row) fail(400, 'We could not create the shoot.')
    return c.json({ id: row.id }, 201)
  })

  .patch('/:id', requireAction('projects', 'edit'), async (c) => {
    const parsed = updateShootRequest.safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success) fail(422, 'Please check the shoot details.')
    const ok = await withUser(c.env, c.get('auth').userId, async (sql) => {
      await sql`update shoots set ${sql(parsed.data)} where id = ${c.req.param('id')!}`
      return true
    }).catch(() => false)
    if (!ok) fail(400, 'We could not update the shoot.')
    return c.body(null, 204)
  })
