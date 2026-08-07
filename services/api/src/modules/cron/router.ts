import { Hono } from 'hono'
import type { AppEnv } from '../../context'
import { fail } from '../../middleware/errors'
import { serviceClient } from '../../lib/supabase'

/** Constant-time string comparison — avoids leaking the secret via timing. */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

/**
 * Cron ingress. Authenticated ONLY by a shared secret compared in constant
 * time. Generators are idempotent + support dry_run (?dry=1). No user context.
 */
export const cronRouter = new Hono<AppEnv>().post('/reminders', async (c) => {
  const provided = c.req.header('x-cron-secret') ?? ''
  const expected = c.env.CRON_SECRET ?? ''
  if (!expected || !timingSafeEqual(provided, expected)) fail(401, 'Unauthorized.')

  const dryRun = c.req.query('dry') === '1'
  const { data, error } = await serviceClient(c.env).rpc('run_reminder_cron', { p_dry_run: dryRun })
  if (error) fail(400, 'The job could not run.')
  return c.json({ ok: true, summary: data })
})
