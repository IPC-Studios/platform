import { config } from '../config'

/**
 * Client crash reporting. window.onerror / unhandledrejection land here and
 * are beaconed to POST /health/client-errors, where they become one log line
 * the request id ties to anything else around it.
 *
 * Reporting must never break the app it reports on: everything is wrapped,
 * fire-and-forget, throttled per message, and silent on failure.
 */

const COOLDOWN_MS = 60_000
const MAX_SIGNATURES = 50
const lastSent = new Map<string, number>()

function shouldSend(signature: string): boolean {
  const now = Date.now()
  const at = lastSent.get(signature)
  if (at !== undefined && now - at < COOLDOWN_MS) return false
  lastSent.set(signature, now)
  // Bounded, insertion-ordered: drop the oldest signature first.
  if (lastSent.size > MAX_SIGNATURES) {
    const oldest = lastSent.keys().next()
    if (!oldest.done) lastSent.delete(oldest.value)
  }
  return true
}

export function reportClientError(kind: 'error' | 'rejection', message: string, stack?: string): void {
  try {
    const clean = message.trim().slice(0, 500)
    if (!clean) return
    // Same crash in a loop reports once a minute, not a thousand times.
    if (!shouldSend(`${kind}:${clean}`)) return
    const body = JSON.stringify({
      kind,
      message: clean,
      ...(stack ? { stack: stack.slice(0, 3000) } : {}),
      url: window.location.href.slice(0, 500),
    })
    const url = `${config.apiBaseUrl}/health/client-errors`
    // Beacon first: it survives page unload, needs no CORS preflight, and
    // never surfaces a rejection to unhandledrejection (which would recurse).
    if (typeof navigator.sendBeacon === 'function') {
      if (navigator.sendBeacon(url, new Blob([body], { type: 'text/plain' }))) return
    }
    void fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body, keepalive: true }).catch(
      () => null,
    )
  } catch {
    // Reporting must never break the app it reports on.
  }
}

/** Idempotent — safe to call once at boot. */
export function installClientErrorReporting(): void {
  if (typeof window === 'undefined') return
  window.addEventListener('error', (e) => {
    reportClientError('error', e.message || 'Script error', e.error instanceof Error ? e.error.stack : undefined)
  })
  window.addEventListener('unhandledrejection', (e) => {
    const r = e.reason as unknown
    reportClientError(
      'rejection',
      r instanceof Error ? (r.message || 'Unhandled rejection') : String(r ?? 'Unhandled rejection'),
      r instanceof Error ? r.stack : undefined,
    )
  })
}
