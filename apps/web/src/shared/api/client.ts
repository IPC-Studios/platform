import type { z } from '@ipc/contracts'
import { config } from '../config'
import { supabase } from '../supabase'
import { MOCK_ENABLED, mockResponse } from '../dev/mock'

/**
 * THE api client. Every call to services/api goes through here — never a
 * per-module copy. Injects the Supabase access token, validates the response
 * against its zod contract, and surfaces the server's error string as-is.
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
    if (canned !== null) return opts.responseSchema.parse(canned)
  }

  const { data } = await supabase.auth.getSession()
  const token = data.session?.access_token

  const init: RequestInit = {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: opts.body === undefined ? null : JSON.stringify(opts.body),
  }
  if (opts.signal) init.signal = opts.signal

  const res = await fetch(`${config.apiBaseUrl}${path}`, init)

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
