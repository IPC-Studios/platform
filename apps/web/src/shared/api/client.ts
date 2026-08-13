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

/**
 * In-flight rotation, shared by every caller that hits a 401 at once — a
 * refresh token is single-use, so a burst of parallel refreshes would spend
 * each other's tokens and look like theft to the server.
 */
let rotating: Promise<boolean> | null = null

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
        clearToken() // refresh rejected → the session is genuinely over
        return false
      }
      const parsed = authToken.safeParse(await res.json().catch(() => null))
      if (!parsed.success) return false
      setTokens(parsed.data)
      return true
    } catch {
      return false // network blip: keep the tokens, let the caller fail
    } finally {
      rotating = null
    }
  })()

  const ok = await rotating
  // Another tab may have rotated while we waited; its token is good to use.
  return ok || getRefreshToken() !== before
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
    const canned = mockResponse(path, method)
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
  // learn one has aged out: rotate and replay, once. The auth endpoints are
  // exempt — /auth/refresh answering 401 must not recurse.
  const canRotate = !path.startsWith('/auth/') || path === '/auth/session'
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
