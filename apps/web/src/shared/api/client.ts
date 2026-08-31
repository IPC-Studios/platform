import { authToken, type z } from '@ipc/contracts'
import { config } from '../config'
import { getToken, getRefreshToken, setTokens, clearToken } from '../auth/token'
import { MOCK_ENABLED, mockResponse, NOT_MOCKED } from '../dev/mock'

/**
 * THE api client. Every call to services/api goes through here — never a
 * per-module copy. Injects the bearer token, validates the response against its
 * zod contract, and surfaces the server's error string as-is.
 */
export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

/** Sign-in paths: a 401 here is bad credentials, not an aged-out token. */
const UNAUTHENTICATED_PATHS = new Set([
  '/auth/refresh',
  '/auth/login',
  '/auth/register',
  '/auth/verify',
  '/auth/forgot-password',
  '/auth/reset-password',
  '/auth/resend-verification',
])

/**
 * In-flight rotation, shared by every caller that hits a 401 at once — a
 * refresh token is single-use, so a burst of parallel refreshes would spend
 * each other's tokens and look like theft to the server.
 */
let rotating: Promise<boolean> | null = null

/**
 * Called when a refresh is refused outright, so AuthProvider can drop the
 * session and let the route guard bounce to /login. Without it a dead session
 * leaves the shell rendered with every panel erroring.
 */
let onAuthLost: (() => void) | null = null
export function setAuthLostHandler(fn: (() => void) | null): void {
  onAuthLost = fn
}

async function rotateTokens(): Promise<boolean> {
  const before = getRefreshToken()
  if (!before) return false

  rotating ??= (async () => {
    try {
      const res = await fetch(`${config.apiBaseUrl}/auth/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refresh_token: before }),
      })
      if (!res.ok) {
        // Only an auth refusal means the session is over. A 429 from the shared
        // per-IP limit, a 5xx mid-deploy, or the 60s grace-window 401 that the
        // LOSER of a two-tab race gets are all survivable — clearing here would
        // also wipe the winning tab's freshly stored pair.
        if (res.status === 401 || res.status === 403) {
          if (getRefreshToken() === before) clearToken()
          onAuthLost?.()
        }
        return false
      }
      const parsed = authToken.safeParse(await res.json().catch(() => null))
      if (!parsed.success) return false
      // The store may have been cleared by a sign-out while this was in flight;
      // writing then would resurrect the session we were told to end.
      if (getRefreshToken() !== before) return false
      setTokens(parsed.data)
      return true
    } catch {
      return false // network blip: keep the tokens, let the caller fail
    } finally {
      rotating = null
    }
  })()

  const ok = await rotating
  if (ok) return true
  // Another tab may have rotated while we waited; only a token that is actually
  // present counts — a cleared store is a failure, not someone else's success.
  const after = getRefreshToken()
  return !!after && after !== before
}

interface CallOptions<TOut extends z.ZodTypeAny> {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE'
  body?: unknown
  /** Contract the response is parsed against. */
  responseSchema: TOut
  signal?: AbortSignal
}

export async function callApi<TOut extends z.ZodTypeAny>(
  path: string,
  opts: CallOptions<TOut>,
): Promise<z.infer<TOut>> {
  const method = opts.method ?? 'GET'

  // DEV UI-preview short-circuit — never reached in production.
  if (MOCK_ENABLED) {
    const canned = mockResponse(path, method, opts.body)
    if (canned !== NOT_MOCKED) return opts.responseSchema.parse(canned)
  }

  const send = () => {
    const token = getToken()
    const init: RequestInit = {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: opts.body === undefined ? null : JSON.stringify(opts.body),
    }
    if (opts.signal) init.signal = opts.signal
    return fetch(`${config.apiBaseUrl}${path}`, init)
  }

  let res = await send()

  // Access tokens are short-lived by design, so a 401 is the normal way we
  // learn one has aged out: rotate and replay, once. Only the endpoints that
  // establish a session are exempt (a 401 there means bad credentials, and
  // /auth/refresh must not recurse). Authenticated /auth/* routes are NOT
  // exempt: skipping rotation on /auth/logout-all turned "sign out everywhere"
  // into a silent no-op for any tab idle past the access-token TTL.
  const canRotate = !UNAUTHENTICATED_PATHS.has(path)
  if (res.status === 401 && canRotate && (await rotateTokens())) {
    res = await send()
  }

  const json: unknown = await res.json().catch(() => ({}))

  if (!res.ok) {
    const msg =
      typeof json === 'object' && json && 'error' in json
        ? String((json as { error: unknown }).error)
        : 'Request failed.'
    throw new ApiError(res.status, msg)
  }

  return opts.responseSchema.parse(json)
}
