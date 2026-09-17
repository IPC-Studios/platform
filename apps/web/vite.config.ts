import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { sentryVitePlugin } from '@sentry/vite-plugin'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const dirname = path.dirname(fileURLToPath(import.meta.url))

/**
 * Source maps are uploaded to Sentry, then deleted from the build output.
 *
 * Without them a production stack trace reads `a.b is not a function at
 * chunk-4f2.js:1:88210`, which tells you nothing. With them Sentry shows the
 * original TSX and line.
 *
 * `SENTRY_AUTH_TOKEN` is a BUILD-time secret and belongs in CI, never in the
 * app's runtime env and never in the bundle. It should be an ORGANIZATION auth
 * token, not a personal one: a personal token carries whoever created it and
 * stops working the day they leave. Without the token the plugin is skipped
 * entirely, so `bun run build` still works for anyone who does not have it.
 *
 * `sourcemap: 'hidden'` emits the maps but leaves no `//# sourceMappingURL`
 * comment in the shipped JS, so the browser never fetches them and the code
 * is not readable by visitors — Sentry resolves them server-side by release.
 */
/**
 * The release this build reports, matched to the API's APP_VERSION.
 *
 * The two halves deploy independently — Cloudflare builds the frontend, a
 * GitHub Action redeploys the API — so nothing lines them up unless the commit
 * is read from the build environment on both sides. Cloudflare names it
 * differently for Pages and for Workers Builds, and neither is documented in
 * this repo, so all the plausible ones are tried and an explicit
 * VITE_APP_VERSION still wins. Empty means the app reports "dev", exactly as
 * /health does when APP_VERSION is unset.
 */
const release =
  process.env['VITE_APP_VERSION'] ||
  process.env['CF_PAGES_COMMIT_SHA'] ||
  process.env['WORKERS_CI_COMMIT_SHA'] ||
  process.env['GITHUB_SHA'] ||
  ''
// Narrowed as one object rather than three booleans: under
// exactOptionalPropertyTypes a `string | undefined` cannot be handed to an
// optional `string` field, even inside an `if` that checked all three.
const mapUpload = ((): { authToken: string; org: string; project: string } | null => {
  const authToken = process.env['SENTRY_AUTH_TOKEN']
  const org = process.env['SENTRY_ORG']
  const project = process.env['SENTRY_PROJECT']
  return authToken && org && project ? { authToken, org, project } : null
})()
const uploadMaps = mapUpload !== null

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    ...(mapUpload
      ? [
          sentryVitePlugin({
            ...mapUpload,
            // Must match the `release` the browser SDK reports, or Sentry has
            // maps it cannot match to the events that need them.
            ...(release ? { release: { name: release } } : {}),
            sourcemaps: { filesToDeleteAfterUpload: ['./dist/**/*.map'] },
            telemetry: false,
          }),
        ]
      : []),
  ],
  // config.ts reads import.meta.env.VITE_APP_VERSION; this is what puts the
  // build environment's commit there when nobody set the variable by hand.
  define: {
    'import.meta.env.VITE_APP_VERSION': JSON.stringify(release),
  },
  build: {
    sourcemap: uploadMaps ? 'hidden' : false,
    rollupOptions: {
      output: {
        // Sentry in its own chunk: it changes on its own schedule, so keeping
        // it separate means an app deploy does not invalidate it in everyone's
        // cache — and it makes the cost of the SDK a number you can see in the
        // build output rather than a guess.
        manualChunks: (id) => (id.includes('node_modules/@sentry') ? 'sentry' : undefined),
      },
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(dirname, './src'),
    },
  },
  server: { port: 5173 },
})
