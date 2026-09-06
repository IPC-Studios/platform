import { describe, expect, it } from 'vitest'
import { bulkLeadPatch, updateLeadRequest, updateSavedViewRequest } from './crm'

/**
 * Losing without a reason must fail at the contract, not deep in SQL: the
 * database trigger raises the same rule as 22023, but a 422 naming the field
 * is what the UI can point at.
 */
describe('lost moves require their reason', () => {
  it('updateLeadRequest accepts a lost move with a reason', () => {
    const r = updateLeadRequest.safeParse({ status: 'lost', lost_reason: 'Went elsewhere' })
    expect(r.success).toBe(true)
  })

  it('updateLeadRequest rejects a lost move without one', () => {
    for (const patch of [{ status: 'lost' }, { status: 'lost', lost_reason: null }, { status: 'lost', lost_reason: 'No' }]) {
      const r = updateLeadRequest.safeParse(patch)
      expect(r.success).toBe(false)
    }
  })

  it('bulkLeadPatch accepts a lost batch with a reason', () => {
    const r = bulkLeadPatch.safeParse({
      ids: ['11111111-1111-1111-8111-111111111111'],
      patch: { status: 'lost', lost_reason: 'Budget' },
    })
    expect(r.success).toBe(true)
  })

  it('bulkLeadPatch rejects a lost batch without one, and an empty patch', () => {
    const ids = ['11111111-1111-1111-8111-111111111111']
    expect(bulkLeadPatch.safeParse({ ids, patch: { status: 'lost' } }).success).toBe(false)
    expect(bulkLeadPatch.safeParse({ ids, patch: {} }).success).toBe(false)
  })
})

describe('updateSavedViewRequest', () => {
  it('accepts a rename, a visibility change, or both — but not nothing', () => {
    expect(updateSavedViewRequest.safeParse({ name: 'Hot today' }).success).toBe(true)
    expect(updateSavedViewRequest.safeParse({ visibility: 'team' }).success).toBe(true)
    expect(updateSavedViewRequest.safeParse({}).success).toBe(false)
    expect(updateSavedViewRequest.safeParse({ visibility: 'everyone' }).success).toBe(true)
  })
})
