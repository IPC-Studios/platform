/** Public runtime config. Only VITE_* vars reach the browser. */
export const config = {
  // Strip trailing slash(es) so `${apiBaseUrl}/auth/...` never doubles up.
  apiBaseUrl: ((import.meta.env.VITE_API_BASE_URL as string | undefined) ?? '/api').replace(
    /\/+$/,
    '',
  ),
}
