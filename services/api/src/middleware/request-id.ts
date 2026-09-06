import type { Context, Next } from 'hono'
import type { AppEnv } from '../context'

const SAFE_ID = /^[A-Za-z0-9._-]{8,128}$/

/**
 * Every request gets an id, echoed back as X-Request-Id and stamped on every
 * log line and audit row it produces. An inbound id from a trusted proxy is
 * kept so one incident can be traced across hops; anything odd is replaced.
 */
export async function requestId(c: Context<AppEnv>, next: Next) {
  const inbound = c.req.header('X-Request-Id') ?? ''
  const id = SAFE_ID.test(inbound) ? inbound : crypto.randomUUID()
  c.set('requestId', id)
  c.header('X-Request-Id', id)
  await next()
}

/** The current request's id, or a fresh one if middleware has not run (tests). */
export function currentRequestId(c: Context<AppEnv>): string {
  const id = c.get('requestId')
  if (id) return id
  const fresh = crypto.randomUUID()
  c.set('requestId', fresh)
  return fresh
}
