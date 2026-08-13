import { sign, verify } from 'hono/jwt'
import type { Env } from '../context'

/**
 * Self-issued auth (replaces GoTrue). HS256 access tokens carrying the user id
 * as `sub`; passwords hashed with Bun.password (argon2id). No refresh token for
 * now — a 7-day access token; add rotation later if needed.
 */
const TTL_SECONDS = 7 * 24 * 60 * 60

/**
 * `pwv` is the user's password_version at issue time. A reset bumps the stored
 * version, which strands every token minted before it — see requireAuth. Tokens
 * predating this claim read as 0, the same as a user who has never reset.
 */
export async function issueToken(env: Env, uid: string, pwv = 0): Promise<string> {
  const now = Math.floor(Date.now() / 1000)
  return sign({ sub: uid, pwv, iat: now, exp: now + TTL_SECONDS }, env.JWT_SECRET)
}

/** Returns the token's claims if it is valid + unexpired, else null. */
export async function verifyToken(
  env: Env,
  token: string,
): Promise<{ uid: string; pwv: number } | null> {
  try {
    const payload = await verify(token, env.JWT_SECRET, 'HS256')
    if (typeof payload.sub !== 'string') return null
    return { uid: payload.sub, pwv: typeof payload.pwv === 'number' ? payload.pwv : 0 }
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
