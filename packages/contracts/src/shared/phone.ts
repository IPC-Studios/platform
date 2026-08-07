/**
 * Phone normalisation — MUST stay byte-identical to the original
 * (`_shared/phone.ts`) or historical dedupe / identity keys break.
 *
 * Rules (from security model 5.9):
 *   1. digits only
 *   2. strip a leading "00" (international dial-out prefix)
 *   3. if exactly 10 digits, prefix "91" (India country code)
 *   4. cap at 15 digits (E.164 max)
 *   5. reject fewer than 7 digits
 */
export function normalizePhone(input: string): string | null {
  let digits = input.replace(/\D/g, '')
  if (digits.startsWith('00')) digits = digits.slice(2)
  if (digits.length === 10) digits = '91' + digits
  if (digits.length > 15) digits = digits.slice(0, 15)
  if (digits.length < 7) return null
  return digits
}
