/**
 * Razorpay HMAC-SHA256 signature verification (Web Crypto — Workers-native).
 * For a payment: message = `${order_id}|${payment_id}`.
 * For a webhook: message = the raw request body.
 */
export async function verifyRazorpaySignature(
  message: string,
  signatureHex: string,
  secret: string,
): Promise<boolean> {
  if (!secret || !signatureHex) return false
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const mac = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message))
  const bytes = new Uint8Array(mac)
  const expected = Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
  // Constant-time compare.
  if (expected.length !== signatureHex.length) return false
  let diff = 0
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ signatureHex.charCodeAt(i)
  return diff === 0
}
