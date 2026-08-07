import { Hono } from 'hono'
import { cors } from 'hono/cors'
import type { AppEnv } from './context'
import { errorBoundary } from './middleware/errors'
import { securityHeaders, rateLimit } from './middleware/security'
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
import { crmRouter } from './modules/crm/router'
import { webhooksRouter } from './modules/webhooks/router'
import { hrRouter } from './modules/hr/router'
import { cronRouter } from './modules/cron/router'
import { notificationsRouter } from './modules/notifications/router'
import { subscriptionRouter } from './modules/subscription/router'
import { termsRouter, publicTermsRouter } from './modules/terms/router'
import { settingsRouter } from './modules/settings/router'

const app = new Hono<AppEnv>()

app.use('*', errorBoundary)
app.use('*', securityHeaders)
// CORS from an env allowlist. Forgiving of trailing slashes and a "*" entry;
// empty ALLOWED_ORIGINS = allow all (dev).
app.use('*', (c, next) => {
  const stripSlash = (s: string) => s.replace(/\/+$/, '')
  const allow = (c.env.ALLOWED_ORIGINS ?? '')
    .split(',')
    .map((o) => stripSlash(o.trim()))
    .filter(Boolean)
  return cors({
    origin: (origin) => {
      if (allow.length === 0 || allow.includes('*')) return origin || '*'
      return allow.includes(stripSlash(origin ?? '')) ? origin : ''
    },
    allowHeaders: ['Authorization', 'Content-Type'],
    allowMethods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
  })(c, next)
})

// Rate limit the unauthenticated / abuse-prone surfaces.
app.use('/auth/*', rateLimit({ windowMs: 60_000, limit: 20 }))
app.use('/public/*', rateLimit({ windowMs: 60_000, limit: 30 }))
app.use('/webhooks/*', rateLimit({ windowMs: 60_000, limit: 120 }))

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
app.route('/crm', crmRouter)
app.route('/webhooks', webhooksRouter)
app.route('/hr', hrRouter)
app.route('/cron', cronRouter)
app.route('/notifications', notificationsRouter)
app.route('/subscription', subscriptionRouter)
app.route('/terms', termsRouter)
app.route('/public', publicTermsRouter)
app.route('/settings', settingsRouter)

export default app
