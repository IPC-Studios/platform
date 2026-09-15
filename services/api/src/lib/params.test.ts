import { describe, expect, it } from 'vitest'
import type { Context } from 'hono'
import type { AppEnv } from '../context'
import { numberQuery, uuidQuery } from './params'

/** Just enough Context for the query readers: they only call c.req.query(key). */
function ctx(query: Record<string, string>): Context<AppEnv> {
  return { req: { query: (k: string) => query[k] } } as unknown as Context<AppEnv>
}

describe('numberQuery', () => {
  it('is null when the caller sent nothing', () => {
    // The bug: Number('') is 0, so a missing max_amount became `amount <= 0`
    // and the company-expenses list returned nothing for every studio that
    // had expenses — while the summary tiles above it counted them fine.
    expect(numberQuery(ctx({}), 'max_amount', 'amount_max')).toBeNull()
  })

  it('is null for a blank or whitespace value', () => {
    expect(numberQuery(ctx({ max_amount: '' }), 'max_amount')).toBeNull()
    expect(numberQuery(ctx({ max_amount: '   ' }), 'max_amount')).toBeNull()
  })

  it('keeps an explicit zero, which is a real filter', () => {
    expect(numberQuery(ctx({ min_amount: '0' }), 'min_amount')).toBe(0)
  })

  it('reads the value', () => {
    expect(numberQuery(ctx({ max_amount: '2500.5' }), 'max_amount')).toBe(2500.5)
  })

  it('falls through to the alias key', () => {
    expect(numberQuery(ctx({ amount_max: '900' }), 'max_amount', 'amount_max')).toBe(900)
  })

  it('prefers the first key that was actually sent', () => {
    expect(numberQuery(ctx({ max_amount: '1', amount_max: '2' }), 'max_amount', 'amount_max')).toBe(1)
  })

  it('rejects a value that is not a number', () => {
    expect(() => numberQuery(ctx({ min_amount: 'abc' }), 'min_amount')).toThrow()
  })
})

describe('uuidQuery', () => {
  it('is null when absent', () => {
    expect(uuidQuery(ctx({}), 'project_id')).toBeNull()
  })

  it('returns a well-formed id', () => {
    const id = '87fbbc34-6b91-414a-99a5-98dc9465138a'
    expect(uuidQuery(ctx({ project_id: id }), 'project_id')).toBe(id)
  })

  it('rejects a malformed id rather than letting Postgres cast it', () => {
    expect(() => uuidQuery(ctx({ project_id: 'not-an-id' }), 'project_id')).toThrow()
  })
})
