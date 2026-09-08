/**
 * Reading a `jsonb` value returned by an RPC.
 *
 * postgres.js decodes jsonb for us, so the value arrives as an already-parsed
 * object. Calling JSON.parse() on it coerces the object to the string
 * "[object Object]" first and then fails on the word `object` -- which is
 * exactly what took out every dashboard backed by one of these functions:
 *
 *   JSON Parse error: Unexpected identifier "object"
 *
 * A string is still accepted, so this keeps working whichever way the driver's
 * type parsers are configured.
 */
export function rpcJson<T>(value: unknown, fallback: T): T {
  if (value === null || value === undefined) return fallback
  return typeof value === 'string' ? (JSON.parse(value) as T) : (value as T)
}
