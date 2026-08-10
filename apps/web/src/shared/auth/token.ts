/**
 * Bearer token store (replaces the Supabase session). The API issues a JWT on
 * login/register; we persist it in localStorage and attach it to every call.
 */
const KEY = 'ipc_access_token'

export function getToken(): string | null {
  try {
    return localStorage.getItem(KEY)
  } catch {
    return null
  }
}

export function setToken(token: string): void {
  try {
    localStorage.setItem(KEY, token)
  } catch {
    /* storage disabled — session won't persist across reloads */
  }
}

export function clearToken(): void {
  try {
    localStorage.removeItem(KEY)
  } catch {
    /* no-op */
  }
}
