import { resolve } from 'node:path'
import { defineConfig } from 'vitest/config'

/**
 * One suite for the whole monorepo (packages, services, supabase, web). The
 * only thing it has to add is the web app's `@/` alias — without it a test can
 * only reach source that never imports across the app, which quietly pushes
 * logic out of shared modules to keep it testable.
 */
export default defineConfig({
  resolve: {
    alias: { '@': resolve(import.meta.dirname, 'apps/web/src') },
  },
})
