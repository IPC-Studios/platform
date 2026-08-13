/**
 * Token store (replaces the Supabase session). The API issues a short-lived
 * access token plus a rotating refresh token; both live in localStorage and the
 * access token is attached to every call.
 */
const KEY = 'ipc_access_token'
const REFRESH_KEY = 'ipc_refresh_token'

const read = (k: string): string | null => {
  try {
    return localStorage.getItem(k)
  } catch {
    return null
  }
}

const write = (k: string, v: string): void => {
  try {
    localStorage.setItem(k, v)
  } catch {
    /* storage disabled — session won't persist across reloads */
  }
}

export function getToken(): string | null {
  return read(KEY)
}

export function getRefreshToken(): string | null {
  return read(REFRESH_KEY)
}

export function setToken(token: string): void {
  write(KEY, token)
}

/** Persist a freshly minted pair (sign-in, or a rotation). */
export function setTokens(pair: { access_token: string; refresh_token: string }): void {
  write(KEY, pair.access_token)
  write(REFRESH_KEY, pair.refresh_token)
}

export function clearToken(): void {
  try {
    localStorage.removeItem(KEY)
    localStorage.removeItem(REFRESH_KEY)
  } catch {
    /* no-op */
  }
}
