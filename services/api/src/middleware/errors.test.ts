import { describe, expect, it, vi } from 'vitest'
import { Hono } from 'hono'
import type { AppEnv } from '../context'
import { errorHandler, notFoundHandler, fail } from './errors'
import { requestId } from './request-id'

const env = { ENVIRONMENT: 'test' } as AppEnv['Bindings']

/**
 * These assert the SHAPE of a failure, not just its status. Every client reads
 * `error` out of the body; when the handler was mounted as middleware it never
 * ran, the bare message came back instead, and the web app showed every single
 * failure as "Request failed." Only a body assertion catches that.
 */
function build() {
  const app = new Hono<AppEnv>()
  app.use('*', requestId)
  app.get('/refused', () => fail(401, 'Invalid email or password.'))
  app.get('/broken', () => {
    throw new Error('boom')
  })
  app.onError(errorHandler)
  app.notFound(notFoundHandler)
  return app
}

describe('error envelope', () => {
  it('returns a thrown HTTPException as JSON the client can read', async () => {
    const res = await build().request('/refused', {}, env)
    expect(res.status).toBe(401)
    expect(res.headers.get('content-type')).toContain('application/json')
    expect(await res.json()).toEqual({ error: 'Invalid email or password.' })
  })

  it('returns an unexpected throw as an opaque message plus a correlation id', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const res = await build().request('/broken', { headers: { 'X-Request-Id': 'req-abc-123' } }, env)
    spy.mockRestore()
    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({
      error: 'Something went wrong. Please try again.',
      correlation_id: 'req-abc-123',
    })
  })

  it('returns an unknown route in the same envelope', async () => {
    const res = await build().request('/nope', {}, env)
    expect(res.status).toBe(404)
    expect((await res.json()) as { error: string }).toHaveProperty('error')
  })
})
