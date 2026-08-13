import { sign, verify } from 'hono/jwt'
import type { Env } from '../context'

/**
 * Self-issued auth (replaces GoTrue). HS256 access tokens carrying the user id
 * as `sub`; passwords hashed with Bun.password (argon2id). No refresh token for
 * now — a 7-day access token; add rotation later if needed.
 */
const TTL_SECONDS = 7 * 24 * 60 * 60

export async function issueToken(env: Env, uid: string): Promise<string> {
  const now = Math.floor(Date.now() / 1000)
  return sign({ sub: uid, iat: now, exp: now + TTL_SECONDS }, env.JWT_SECRET)
}

/**
 * Returns the user id (sub) + issue time if the token is valid + unexpired,
 * else null. `iat` is what lets a password reset evict older sessions — see
 * requireAuth.
 */
export async function verifyToken(
  env: Env,
  token: string,
): Promise<{ uid: string; iat: number } | null> {
  try {
    const payload = await verify(token, env.JWT_SECRET, 'HS256')
    if (typeof payload.sub !== 'string') return null
    return { uid: payload.sub, iat: typeof payload.iat === 'number' ? payload.iat : 0 }
  } catch {
    return null
  }
}

export function hashPassword(password: string): Promise<string> {
  return Bun.password.hash(password) // argon2id
}

export function verifyPassword(password: string, hash: string): Promise<boolean> {
  return Bun.password.verify(password, hash)
}
