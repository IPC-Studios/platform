import { Hono } from 'hono'
import { captureLeadRequest } from '@ipc/contracts'
import type { AppEnv } from '../../context'
import { fail } from '../../middleware/errors'
import { serviceClient } from '../../lib/supabase'

/**
 * PUBLIC webhook ingress — no auth. The source key resolves the tenant inside
 * the capture_lead RPC; the service client is used only to invoke that RPC,
 * which itself dedupes and auto-assigns. Meta and generic web forms share it.
 */
export const webhooksRouter = new Hono<AppEnv>()
  .post('/lead/:sourceKey', async (c) => {
    const parsed = captureLeadRequest.safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success) fail(422, 'Invalid lead payload.')
    const { data, error } = await serviceClient(c.env).rpc('capture_lead', {
      p_source_key: c.req.param('sourceKey'),
      p_name: parsed.data.name ?? null,
      p_phone: parsed.data.phone,
      p_email: parsed.data.email ?? null,
      p_meta: parsed.data.meta ?? {},
    })
    if (error || !data) fail(400, 'We could not capture this lead.')
    return c.json({ id: data as string }, 201)
  })

  // Meta subscription verification handshake (GET with hub.challenge).
  .get('/meta', (c) => {
    const challenge = c.req.query('hub.challenge')
    if (challenge) return c.text(challenge)
    return c.json({ ok: true })
  })
