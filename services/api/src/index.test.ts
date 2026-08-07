import { describe, expect, it } from 'vitest'
import app from './index'

describe('api app', () => {
  it('GET /health is public and returns ok', async () => {
    const res = await app.request('/health', {}, { ENVIRONMENT: 'test' })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true, service: 'ipc-api', env: 'test' })
  })

  it('unknown route 404s cleanly', async () => {
    const res = await app.request('/nope', {}, { ENVIRONMENT: 'test' })
    expect(res.status).toBe(404)
  })
})
