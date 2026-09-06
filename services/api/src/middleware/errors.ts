import type { Context, Next } from 'hono'
import { HTTPException } from 'hono/http-exception'
import type { AppEnv } from '../context'
import { describeError, log } from '../lib/log'
import { reportError } from '../lib/error-reporter'
import { currentRequestId } from './request-id'

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
    // Unknown failure: log structured detail under the request id, return an
    // opaque message + the id (so support can find the log).
    const correlationId = currentRequestId(c)
    const d = describeError(err)
    log.error(
      {
        requestId: correlationId,
        method: c.req.method,
        path: c.req.path,
        code: d.code,
        message: d.message,
        stack: d.stack,
      },
      'unhandled error',
    )
    reportError(c.env, err, { requestId: correlationId, method: c.req.method, path: c.req.path })
    c.header('X-Correlation-Id', correlationId)
    return c.json({ error: 'Something went wrong. Please try again.', correlation_id: correlationId }, 500)
  }
}

/** Throw this from anywhere to return a clean status to the client. */
export function fail(status: 400 | 401 | 403 | 404 | 409 | 422 | 503, message: string): never {
  throw new HTTPException(status, { message })
}
