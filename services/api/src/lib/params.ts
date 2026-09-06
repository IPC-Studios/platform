import type { Context } from 'hono'
import type { AppEnv } from '../context'
import { fail } from '../middleware/errors'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

/**
 * Route params reach Postgres as uuids; a malformed one is a miss (404), never
 * a 500 from a cast error. Also narrows the type: Hono hands back
 * `string | undefined` for any param name.
 */
export function uuidParam(c: Context<AppEnv>, key = 'id'): string {
  const v = c.req.param(key)
  if (!v || !UUID_RE.test(v)) fail(404, 'We could not find that record.')
  return v
}

/** A YYYY-MM-DD path segment. */
export function dateParam(c: Context<AppEnv>, key = 'date'): string {
  const v = c.req.param(key)
  if (!v || !DATE_RE.test(v)) fail(422, 'Invalid date.')
  return v
}

/** An opaque token or key segment: present and bounded, nothing more. */
export function textParam(c: Context<AppEnv>, key: string, max = 200): string {
  const v = c.req.param(key)
  if (!v || v.length > max) fail(404, 'We could not find that record.')
  return v
}
