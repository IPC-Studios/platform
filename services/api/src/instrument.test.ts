import { describe, expect, it } from 'vitest'
import { sampleRate, scrubSensitive } from './instrument'

/**
 * What must never leave the building, and how much of the traffic is traced.
 *
 * Sentry is a third party. Everything these two functions let through is
 * copied onto someone else's servers and kept there for ninety days, so the
 * cost of a regression is not a broken feature — it is a credential in an
 * external system that nobody knows is there.
 */
describe('scrubbing an event before it is sent', () => {
  it('redacts a Postgres connection string', () => {
    // postgres.js puts the whole DSN, password included, into its connection
    // errors — and a database that has just gone down produces a lot of them.
    const msg = 'connect ECONNREFUSED postgres://authenticator:hunter2@db:5432/ipc'
    const out = scrubSensitive(msg)
    expect(out).not.toContain('hunter2')
    expect(out).not.toContain('authenticator')
    expect(out).toContain('postgres://[redacted]')
  })

  it('redacts the postgresql:// spelling too', () => {
    expect(scrubSensitive('postgresql://u:p@h/db failed')).toContain('postgres://[redacted]')
    expect(scrubSensitive('postgresql://u:p@h/db failed')).not.toContain(':p@')
  })

  it('redacts a JWT', () => {
    const jwt = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk'
    const out = scrubSensitive(`token rejected: ${jwt}`)
    expect(out).toBe('token rejected: [jwt]')
  })

  it('redacts every occurrence, not just the first', () => {
    const out = scrubSensitive('postgres://a:b@h/x then postgres://c:d@h/y')
    expect(out).not.toContain('b@')
    expect(out).not.toContain('d@')
  })

  it('leaves an ordinary message alone', () => {
    // Over-redacting is its own failure: an error nobody can read is an error
    // nobody fixes.
    const msg = 'Quote QT-0042 could not be sent: the lead has no phone number'
    expect(scrubSensitive(msg)).toBe(msg)
  })

  it('does not mangle a plain URL', () => {
    const msg = 'GET https://ipcstudios.duckdns.org/crm/leads failed'
    expect(scrubSensitive(msg)).toBe(msg)
  })
})

describe('choosing the trace sample rate', () => {
  it('uses the configured rate when it is a sane fraction', () => {
    expect(sampleRate('0.25', 0.1)).toBe(0.25)
    expect(sampleRate('1', 0.1)).toBe(1)
  })

  it('honours an explicit zero rather than treating it as unset', () => {
    // 0 is how tracing gets switched off while errors keep flowing. A falsy
    // check here would quietly restore the default and keep billing.
    expect(sampleRate('0', 0.1)).toBe(0)
  })

  it('falls back when the value is missing or nonsense', () => {
    expect(sampleRate(undefined, 0.1)).toBe(0.1)
    expect(sampleRate('', 0.1)).toBe(0.1)
    expect(sampleRate('half', 0.1)).toBe(0.1)
  })

  it('falls back when the value is out of range', () => {
    // 100 meaning "100%" is the obvious typo, and taken literally it would
    // trace every request a hundred times over the intended budget.
    expect(sampleRate('100', 0.1)).toBe(0.1)
    expect(sampleRate('-1', 0.1)).toBe(0.1)
  })
})
