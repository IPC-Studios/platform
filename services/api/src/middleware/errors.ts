import type { Context, Next } from 'hono'
import { HTTPException } from 'hono/http-exception'
import type { AppEnv } from '../context'

/**
 * Central error boundary. Error STRINGS are UI copy; diagnostics go to logs,
 * never to the client. Any thrown HTTPException carries a safe message.
 */
export async function errorBoundary(c: Context<AppEnv>, next: Next) {
  try {
    await next()
  } catch (err) {
    if (err instanceof HTTPException) {
      return c.json({ error: err.message }, err.status)
    }
    // Unknown failure: log detail, return an opaque message.
    console.error('unhandled', err)
    return c.json({ error: 'Something went wrong. Please try again.' }, 500)
  }
}

/** Throw this from anywhere to return a clean 4xx to the client. */
export function fail(status: 400 | 401 | 403 | 404 | 409 | 422, message: string): never {
  throw new HTTPException(status, { message })
}
