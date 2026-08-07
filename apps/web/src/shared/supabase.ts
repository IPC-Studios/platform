import { createClient } from '@supabase/supabase-js'
import { config } from './config'

/** The one browser Supabase client — holds the session, used for auth only. */
export const supabase = createClient(config.supabaseUrl, config.supabaseAnonKey, {
  auth: { persistSession: true, autoRefreshToken: true },
})
