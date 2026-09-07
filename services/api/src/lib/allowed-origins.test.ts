import { describe, expect, it } from 'vitest'
import { allowedOrigins, isProduction, originAllowed } from './allowed-origins'

describe('allowedOrigins', () => {
  it('normalizes entries (trims, strips trailing slashes, drops empties)', () => {
    expect(allowedOrigins({ ALLOWED_ORIGINS: ' https://a.example/,https://b.example ,, ' })).toEqual([
      'https://a.example',
      'https://b.example',
    ])
  })

  it('is empty when unconfigured', () => {
    expect(allowedOrigins({ ALLOWED_ORIGINS: '' })).toEqual([])
  })
})

describe('originAllowed', () => {
  const prod = { ALLOWED_ORIGINS: 'https://app.example', ENVIRONMENT: 'production' } as const

  it('accepts an allowlisted origin', () => {
    expect(originAllowed(prod, 'https://app.example')).toBe(true)
    expect(originAllowed(prod, 'https://app.example/')).toBe(true)
  })

  it('refuses a foreign origin (the CSRF case)', () => {
    expect(originAllowed(prod, 'https://evil.example')).toBe(false)
  })

  it('fails closed in production when unconfigured', () => {
    expect(originAllowed({ ALLOWED_ORIGINS: '', ENVIRONMENT: 'production' }, 'https://app.example')).toBe(false)
    expect(originAllowed({ ALLOWED_ORIGINS: '*', ENVIRONMENT: 'production' }, 'https://app.example')).toBe(false)
  })

  it('is permissive off production', () => {
    expect(originAllowed({ ALLOWED_ORIGINS: '', ENVIRONMENT: 'development' }, 'https://app.example')).toBe(true)
  })

  it('lets origin-less (non-browser) callers through', () => {
    expect(originAllowed(prod, undefined)).toBe(true)
  })

  it('isProduction matches exactly', () => {
    expect(isProduction({ ENVIRONMENT: 'production' })).toBe(true)
    expect(isProduction({ ENVIRONMENT: 'staging' })).toBe(false)
    expect(isProduction({} as never)).toBe(false)
  })
})
