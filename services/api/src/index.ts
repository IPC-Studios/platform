import { Hono } from 'hono'
import { cors } from 'hono/cors'
import type { AppEnv } from './context'
import { errorBoundary } from './middleware/errors'
import { healthRouter } from './modules/health/router'
import { authRouter } from './modules/auth/router'

const app = new Hono<AppEnv>()

app.use('*', errorBoundary)
// Phase 16 tightens this to known origins.
app.use('*', cors({ origin: '*', allowHeaders: ['Authorization', 'Content-Type'] }))

// ── Routers ───────────────────────────────────────────────────
// One router per domain (~25 total). Domain modules land per phase and mount
// their own auth + permission middleware; /health stays public.
app.route('/health', healthRouter)
app.route('/auth', authRouter)

export default app
