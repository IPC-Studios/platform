import type { Env } from '../context'
import { describeError, log } from './log'

/**
 * Error tracking without an SDK: when SENTRY_DSN is set, unexpected failures
 * are posted as Sentry "store" events (the plain JSON envelope every Sentry
 * host accepts). Unset, this is a no-op — the structured log line is still
 * written either way, so nothing is lost on a bench without a DSN.
 */
interface Dsn {
  endpoint: string
  publicKey: string
}

function parseDsn(dsn: string | undefined): Dsn | null {
  if (!dsn) return null
  try {
    const u = new URL(dsn)
    const projectId = u.pathname.replace(/^\/+/, '')
    if (!u.username || !projectId) return null
    return {
      endpoint: `${u.protocol}//${u.host}/api/${projectId}/store/`,
      publicKey: u.username,
    }
  } catch {
    return null
  }
}

export interface ReportContext {
  requestId: string
  method: string
  path: string
  label?: string
  environment?: string
  release?: string
}

/** Fire-and-forget. Never throws, never awaited on the request path. */
export function reportError(env: Pick<Env, 'SENTRY_DSN' | 'ENVIRONMENT' | 'APP_VERSION'>, err: unknown, ctx: ReportContext): void {
  const dsn = parseDsn(env.SENTRY_DSN)
  if (!dsn) return
  const d = describeError(err)
  const event = {
    event_id: crypto.randomUUID().replace(/-/g, ''),
    timestamp: new Date().toISOString(),
    platform: 'javascript',
    level: 'error',
    logger: 'ipc-api',
    environment: env.ENVIRONMENT ?? 'unknown',
    release: env.APP_VERSION ?? undefined,
    message: d.message,
    exception: {
      values: [
        {
          type: err instanceof Error ? err.name : 'Error',
          value: d.message,
          stacktrace: d.stack ? { frames: [{ filename: 'stack', function: d.stack.slice(0, 2000) }] } : undefined,
        },
      ],
    },
    tags: { request_id: ctx.requestId, method: ctx.method, label: ctx.label ?? 'unlabelled', pg_code: d.code ?? 'none' },
    extra: { path: ctx.path },
  }
  const auth = `Sentry sentry_version=7, sentry_client=ipc-api/1.0, sentry_key=${dsn.publicKey}`
  fetch(dsn.endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Sentry-Auth': auth },
    body: JSON.stringify(event),
  }).catch((e: unknown) => {
    log.warn({ requestId: ctx.requestId, ...describeError(e) }, 'error report could not be sent')
  })
}
