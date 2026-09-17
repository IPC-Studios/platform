/** The ipc-web Sentry project. See `sentryDsn` below for why this is in source. */
const DEFAULT_SENTRY_DSN =
  'https://e68d382a58b878cdeb9acc5242625588@o4512100464001025.ingest.de.sentry.io/4512101219500112'

/** Public runtime config. Only VITE_* vars reach the browser. */
export const config = {
  // Strip trailing slash(es) so `${apiBaseUrl}/auth/...` never doubles up.
  apiBaseUrl: ((import.meta.env.VITE_API_BASE_URL as string | undefined) ?? '/api').replace(
    /\/+$/,
    '',
  ),
  /**
   * Sentry DSN for the browser.
   *
   * In source on purpose. A browser DSN is public by design: it ships inside
   * the bundle, is readable by anyone who opens devtools, and can only submit
   * events to its own project. It is not a credential, so keeping it here
   * rather than in the deploy platform's settings costs nothing and means the
   * frontend reports errors without a build-time variable somebody has to
   * remember to set. `.env.*` is gitignored in this repo, so a committed env
   * file was not an option either.
   *
   * The credential that IS secret is the build-time auth token used to upload
   * source maps. That never reaches the browser and lives in CI.
   *
   * VITE_SENTRY_DSN overrides this, and dev builds stay silent — otherwise
   * every local run would file issues against production.
   */
  sentryDsn:
    (import.meta.env.VITE_SENTRY_DSN as string | undefined)?.trim() ||
    (import.meta.env.PROD ? DEFAULT_SENTRY_DSN : ''),
  /**
   * Must match the API's APP_VERSION for a release to line up across both, and
   * must match what the source maps were uploaded under or stack traces stay
   * minified. The deploy sets both from the git SHA.
   */
  appVersion: (import.meta.env.VITE_APP_VERSION as string | undefined)?.trim() || 'dev',
  environment:
    (import.meta.env.VITE_ENVIRONMENT as string | undefined)?.trim() ||
    (import.meta.env.PROD ? 'production' : 'development'),
}
