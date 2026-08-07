import { Hono } from 'hono'
import { cors } from 'hono/cors'
import type { AppEnv } from './context'
import { errorBoundary } from './middleware/errors'
import { healthRouter } from './modules/health/router'
import { authRouter } from './modules/auth/router'
import { accessRouter } from './modules/access/router'
import { clientsRouter } from './modules/clients/router'
import { projectsRouter } from './modules/projects/router'
import { tasksRouter } from './modules/tasks/router'
import { teamRouter } from './modules/team/router'
import { allocationRouter } from './modules/allocation/router'
import { dataRouter } from './modules/data/router'
import { workRouter } from './modules/work/router'
import { billingRouter } from './modules/billing/router'
import { financialsRouter } from './modules/financials/router'

const app = new Hono<AppEnv>()

app.use('*', errorBoundary)
// Phase 16 tightens this to known origins.
app.use('*', cors({ origin: '*', allowHeaders: ['Authorization', 'Content-Type'] }))

// ── Routers ───────────────────────────────────────────────────
// One router per domain (~25 total). Domain modules land per phase and mount
// their own auth + permission middleware; /health stays public.
app.route('/health', healthRouter)
app.route('/auth', authRouter)
app.route('/access', accessRouter)
app.route('/clients', clientsRouter)
app.route('/projects', projectsRouter)
app.route('/tasks', tasksRouter)
app.route('/team', teamRouter)
app.route('/allocation', allocationRouter)
app.route('/data', dataRouter)
app.route('/work', workRouter)
app.route('/billing', billingRouter)
app.route('/financials', financialsRouter)

export default app
