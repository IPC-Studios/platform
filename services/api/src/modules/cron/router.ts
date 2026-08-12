import { Hono } from 'hono'
import type { AppEnv } from '../../context'
import { fail } from '../../middleware/errors'
import { withService } from '../../lib/db'

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
  const result = await withService(c.env, async (sql) => {
    const rows = await sql`select run_reminder_cron(p_dry_run => ${dryRun}) as summary`
    return { summary: rows[0]?.summary as unknown }
  }).catch(() => null)
  if (!result) fail(400, 'The job could not run.')
  return c.json({ ok: true, summary: result!.summary })
})
