import { Hono } from 'hono'
import { createPartyRequest, party } from '@ipc/contracts'
import type { AppEnv } from '../../context'
import { requireAuth } from '../../middleware/auth'
import { fail } from '../../middleware/errors'
import { uuidParam } from '../../lib/params'
import { withUser } from '../../lib/db'
import { attempt } from '../../lib/attempt'
import { audit } from '../../lib/audit'

const list = party.array()

/**
 * Vendors, freelancers, and other parties an expense is paid to or received
 * from — shared between company and personal expenses. Any active member can
 * add one on the fly while logging an expense, the same way a shoot service
 * is typed in rather than picked from an admin-curated list first.
 */
export const partiesRouter = new Hono<AppEnv>()
  .use('*', requireAuth)

  .get('/', async (c) => {
    const rows = await attempt(c, 'parties.list', () =>
      withUser(c.env, c.get('auth').userId, (sql) => sql`select id, name, kind from parties order by name asc`),
    )
    if (!rows) fail(400, 'We could not load parties.')
    return c.json(list.parse(rows))
  })

  .post('/', async (c) => {
    const parsed = createPartyRequest.safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success) fail(422, 'Please name the party.')
    const auth = c.get('auth')
    const row = await attempt(c, 'parties.create', () =>
      withUser(c.env, auth.userId, async (sql) => {
        const rows = await sql`
          insert into parties ${sql({ company_id: auth.companyId, ...parsed.data })}
          returning id, name, kind`
        return rows[0] ?? null
      }),
    )
    if (!row) fail(400, 'We could not add this party.')
    await audit(c, { action: 'party.create', entityType: 'party', entityId: row.id, after: parsed.data })
    return c.json(party.parse(row), 201)
  })

  // Both expense tables reference a party with ON DELETE SET NULL: a past
  // expense keeps its own record of what it paid, it just stops pointing at a
  // party that no longer exists. Deleting one is always allowed.
  .delete('/:id', async (c) => {
    const id = uuidParam(c)
    const rows = await attempt(c, 'parties.delete', () =>
      withUser(c.env, c.get('auth').userId, (sql) => sql<{ id: string }[]>`
        delete from parties where id = ${id} returning id`),
    )
    if (!rows) fail(400, 'We could not delete this party.')
    if (!rows.length) fail(404, 'That party was not found.')
    await audit(c, { action: 'party.delete', entityType: 'party', entityId: id })
    return c.body(null, 204)
  })
