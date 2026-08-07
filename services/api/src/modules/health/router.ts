import { Hono } from 'hono'
import type { AppEnv } from '../../context'

/** Public liveness router — no auth. Proves the Worker + routing are up. */
export const healthRouter = new Hono<AppEnv>().get('/', (c) =>
  c.json({ ok: true, service: 'ipc-api', env: c.env.ENVIRONMENT }),
)
