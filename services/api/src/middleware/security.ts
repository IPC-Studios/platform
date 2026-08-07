import type { Context, Next } from 'hono'
import type { AppEnv } from '../context'

/** Baseline security response headers on every request. */
export async function securityHeaders(c: Context<AppEnv>, next: Next) {
  await next()
  c.header('X-Content-Type-Options', 'nosniff')
  c.header('X-Frame-Options', 'DENY')
  c.header('Referrer-Policy', 'strict-origin-when-cross-origin')
  c.header('Permissions-Policy', 'geolocation=(self)')
}

/**
 * Pure sliding-window rate-limit decision. Keeps only timestamps inside the
 * window and allows the request iff the count is under the limit.
 * Returns the pruned timestamp list to store back.
 */
export function slidingWindow(
  hits: ReadonlyArray<number>,
  now: number,
  windowMs: number,
  limit: number,
): { allowed: boolean; next: number[] } {
  const fresh = hits.filter((t) => t > now - windowMs)
  if (fresh.length >= limit) return { allowed: false, next: fresh }
  return { allowed: true, next: [...fresh, now] }
}

// Per-isolate store. Real multi-instance limiting needs KV/Durable Objects
// (see docs/RUNBOOK.md); this is a best-effort in-isolate backstop.
const buckets = new Map<string, number[]>()

/** Best-effort per-IP rate limit for mutating routes. */
export function rateLimit(opts: { windowMs: number; limit: number }) {
  return async (c: Context<AppEnv>, next: Next) => {
    const ip = c.req.header('CF-Connecting-IP') ?? c.req.header('X-Forwarded-For') ?? 'unknown'
    const key = `${ip}:${c.req.path}`
    // Date.now is fine at runtime; only workflow scripts forbid it.
    const now = Date.now()
    const { allowed, next: updated } = slidingWindow(
      buckets.get(key) ?? [],
      now,
      opts.windowMs,
      opts.limit,
    )
    buckets.set(key, updated)
    if (!allowed) return c.json({ error: 'Too many requests. Please slow down.' }, 429)
    await next()
  }
}
