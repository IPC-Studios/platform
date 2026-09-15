// Pre-deploy check: apply EVERY migration in filename order against pglite,
// the same order deploy/db/migrate.sh uses. Catches SQL/ordering errors in the
// 0097+ files, which no test or CI run has ever executed. Pass 2 re-applies
// every file to prove idempotency (a retried/partial deploy re-runs them).
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { PGlite } from '@electric-sql/pglite'

const migDir = 'E:/BuildOurs/IPC Studios CRM/supabase/migrations'
const files = readdirSync(migDir)
  .filter((f) => f.endsWith('.sql') && !f.startsWith('0000_'))
  .sort()

const db = new PGlite()
await db.exec(`create schema if not exists auth;`)
await db.exec(
  `create table auth.users (id uuid primary key default gen_random_uuid(), email text unique not null, encrypted_password text);`,
)
await db.exec(
  `create or replace function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;`,
)
for (const r of ['authenticated', 'anon', 'service_role', 'authenticator'])
  await db.exec(`create role ${r};`)

let failed = 0
async function pass(label, verbose) {
  for (const f of files) {
    try {
      await db.exec(readFileSync(join(migDir, f), 'utf8'))
      if (verbose && Number(f.slice(0, 4)) >= 97) console.log(`ok   ${f}`)
    } catch (e) {
      failed++
      console.log(`${label} ${f}\n     ${String(e.message).split('\n')[0]}`)
    }
  }
}
await pass('FAIL', true)
console.log('\n--- pass 2: re-apply all (idempotency) ---')
await pass('REAPPLY-FAIL', false)

console.log(`\n${files.length} files x2 passes, ${failed} failures`)
process.exit(failed ? 1 : 0)
