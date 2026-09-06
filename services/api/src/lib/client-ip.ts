/**
 * Which header carries the real client address depends on what sits in front
 * of the API, and trusting the wrong one hands every caller a way to pick
 * their own rate-limit bucket. So the header is configuration, not a guess:
 *
 *   CLIENT_IP_HEADER=X-Forwarded-For   (default; Caddy, nginx, most proxies)
 *   CLIENT_IP_HEADER=CF-Connecting-IP  (Cloudflare in front)
 *
 * For X-Forwarded-For the LAST hop is used — it is the one appended by our own
 * proxy; anything before it was supplied by the client.
 */
export interface HeaderReader {
  get(name: string): string | undefined | null
}

export function resolveClientIp(headers: HeaderReader, configured: string | undefined): string {
  const name = (configured ?? '').trim() || 'X-Forwarded-For'
  const raw = headers.get(name) ?? ''
  if (!raw) return 'unknown'
  if (name.toLowerCase() === 'x-forwarded-for') {
    const parts = raw
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
    return parts[parts.length - 1] ?? 'unknown'
  }
  return raw.trim() || 'unknown'
}
