import type { Env } from '../context'

const stripSlash = (s: string) => s.replace(/\/+$/, '')

/** The allowlist as a normalized list. Empty means "not configured". */
export function allowedOrigins(env: Pick<Env, 'ALLOWED_ORIGINS'>): string[] {
  return (env.ALLOWED_ORIGINS ?? '')
    .split(',')
    .map((o) => stripSlash(o.trim()))
    .filter(Boolean)
}

export function isProduction(env: Pick<Env, 'ENVIRONMENT'>): boolean {
  return (env.ENVIRONMENT ?? '') === 'production'
}

/**
 * Whether a request Origin may drive credentialed side effects (cookie
 * refresh). Browsers always send Origin on POST, so a cross-site forgery
 * carries the attacker's origin and is refused here; non-browser callers send
 * none and pass through. Fail-closed in production when unconfigured.
 */
export function originAllowed(
  env: Pick<Env, 'ALLOWED_ORIGINS' | 'ENVIRONMENT'>,
  origin: string | undefined,
): boolean {
  if (!origin) return true
  const allow = allowedOrigins(env)
  if (allow.length === 0 || allow.includes('*')) return !isProduction(env)
  return allow.includes(stripSlash(origin))
}
