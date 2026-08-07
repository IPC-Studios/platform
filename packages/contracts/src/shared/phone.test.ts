import { describe, expect, it } from 'vitest'
import { normalizePhone } from './phone'

describe('normalizePhone — must match legacy byte-for-byte', () => {
  it('prefixes 91 for a bare 10-digit Indian number', () => {
    expect(normalizePhone('9876543210')).toBe('919876543210')
  })

  it('strips separators and formatting', () => {
    expect(normalizePhone('+91 98765-43210')).toBe('919876543210')
    expect(normalizePhone('(987) 654 3210')).toBe('919876543210')
  })

  it('strips a leading 00 dial-out prefix', () => {
    expect(normalizePhone('00919876543210')).toBe('919876543210')
  })

  it('does NOT re-prefix an already-countried number', () => {
    expect(normalizePhone('919876543210')).toBe('919876543210')
  })

  it('caps at 15 digits (E.164 max)', () => {
    expect(normalizePhone('1234567890123456789')).toBe('123456789012345')
  })

  it('rejects fewer than 7 digits', () => {
    expect(normalizePhone('123456')).toBeNull()
    expect(normalizePhone('abc')).toBeNull()
  })
})
