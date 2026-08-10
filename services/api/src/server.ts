// VPS / container entrypoint (Bun). NOT used on Cloudflare — there the Worker
// runtime imports the default export and supplies `env` (the bindings) itself.
//
// The whole app reads config via `c.env.*`. Hono's fetch takes `env` as its
// second arg and exposes it as `c.env`, so passing `process.env` here makes
// every existing `c.env.SUPABASE_URL` etc. work unchanged — no handler edits.
//
// Excluded from `tsc` typecheck (see tsconfig) because it depends on the Bun
// global rather than @cloudflare/workers-types; Bun runs it directly.
import app from './index'

const port = Number(process.env.PORT ?? 8787)

Bun.serve({
  port,
  idleTimeout: 30,
  fetch: (req) => app.fetch(req, process.env),
})

console.log(`ipc-api listening on :${port}`)
