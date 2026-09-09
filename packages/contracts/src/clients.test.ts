import { describe, expect, it } from 'vitest'
import { updateClientRequest } from './clients'

/**
 * An edit form resends every optional field explicitly so clearing one in
 * the UI actually clears it on the server, instead of a falsy value being
 * left out of the patch and the old value silently surviving.
 */
describe('updateClientRequest', () => {
  it('accepts null on every optional field, to clear it', () => {
    const r = updateClientRequest.safeParse({
      phone: null,
      alternate_phone: null,
      email: null,
      city: null,
      address: null,
      relation: null,
      gstin: null,
      notes: null,
    })
    expect(r.success).toBe(true)
  })

  it('treats an empty-string email the same as clearing it', () => {
    const r = updateClientRequest.safeParse({ email: '' })
    expect(r.success).toBe(true)
    if (r.success) expect(r.data.email).toBeNull()
  })

  it('still rejects a malformed email', () => {
    expect(updateClientRequest.safeParse({ email: 'not-an-email' }).success).toBe(false)
  })

  it('an empty patch is still valid — the edit dialog may resend no changes', () => {
    expect(updateClientRequest.safeParse({}).success).toBe(true)
  })

  it('checks a GSTIN\'s format when one is given, upper-cased, but leaves it out entirely', () => {
    const lower = updateClientRequest.safeParse({ gstin: '27abcde1234f1z5' })
    expect(lower.success).toBe(true)
    if (lower.success) expect(lower.data.gstin).toBe('27ABCDE1234F1Z5')

    expect(updateClientRequest.safeParse({ gstin: 'not-a-gstin' }).success).toBe(false)

    const cleared = updateClientRequest.safeParse({ gstin: '' })
    expect(cleared.success).toBe(true)
    if (cleared.success) expect(cleared.data.gstin).toBe('')
  })
})
