/** Public runtime config. Only VITE_* vars reach the browser. */
export const config = {
  supabaseUrl: import.meta.env.VITE_SUPABASE_URL as string,
  supabaseAnonKey: import.meta.env.VITE_SUPABASE_ANON_KEY as string,
  // Strip trailing slash(es) so `${apiBaseUrl}/auth/...` never doubles up.
  apiBaseUrl: ((import.meta.env.VITE_API_BASE_URL as string | undefined) ?? '/api').replace(
    /\/+$/,
    '',
  ),
}
