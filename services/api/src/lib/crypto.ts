/**
 * Constant-time string comparison. Iterates to the LONGER length and folds the
 * length difference into the result, so neither the mismatch position nor the
 * length of the secret leaks through timing.
 */
export function timingSafeEqual(a: string, b: string): boolean {
  let diff = a.length ^ b.length
  const max = Math.max(a.length, b.length)
  for (let i = 0; i < max; i++) diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0)
  return diff === 0
}

/** Lowercase hex of a byte buffer. */
export function toHex(bytes: ArrayBuffer | Uint8Array): string {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)
  return Array.from(view)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}
