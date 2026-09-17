/** Public runtime config. Only VITE_* vars reach the browser. */
export const config = {
  // Strip trailing slash(es) so `${apiBaseUrl}/auth/...` never doubles up.
  apiBaseUrl: ((import.meta.env.VITE_API_BASE_URL as string | undefined) ?? '/api').replace(
    /\/+$/,
    '',
  ),
  /**
   * Sentry DSN for the browser. Empty = Sentry is off and crashes fall back to
   * the beacon in `error/report.ts`.
   *
   * A browser DSN is public by design — it ships inside the bundle and can
   * only submit events to its own project. It is not a credential and does not
   * belong in a secret store. The token that IS secret is the build-time auth
   * token used to upload source maps, which never reaches the browser.
   */
  sentryDsn: (import.meta.env.VITE_SENTRY_DSN as string | undefined)?.trim() ?? '',
  /**
   * Must match the API's APP_VERSION for a release to line up across both, and
   * must match what the source maps were uploaded under or stack traces stay
   * minified. The deploy sets both from the git SHA.
   */
  appVersion: (import.meta.env.VITE_APP_VERSION as string | undefined)?.trim() || 'dev',
  environment: (import.meta.env.VITE_ENVIRONMENT as string | undefined)?.trim() || 'unknown',
}
