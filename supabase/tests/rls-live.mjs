// Live cross-tenant RLS verification against a REAL Supabase project.
// Proves that a user in studio A cannot read studio B's data — the enforcement
// pglite can't test (it runs as superuser). Creates two throwaway studios.
//
// Usage:
//   SUPABASE_URL=... SUPABASE_ANON_KEY=sb_publishable_... API_URL=... bun supabase/tests/rls-live.mjs
import { createClient } from '@supabase/supabase-js'

const URL = process.env.SUPABASE_URL
const ANON = process.env.SUPABASE_ANON_KEY
const API = (process.env.API_URL ?? '').replace(/\/+$/, '')
if (!URL || !ANON || !API) {
  console.error('Set SUPABASE_URL, SUPABASE_ANON_KEY, API_URL')
  process.exit(2)
}

const rand = () => Math.random().toString(36).slice(2, 10)
let pass = 0
let fail = 0
const check = (name, ok) => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`)
  ok ? pass++ : fail++
}

async function makeStudio(label) {
  const client = createClient(URL, ANON, { auth: { persistSession: false } })
  const email = `rls-${label}-${rand()}@example.com`
  const { data: signUp, error: suErr } = await client.auth.signUp({
    email,
    password: 'Testpass12345!',
  })
  if (suErr) throw new Error(`signup ${label}: ${suErr.message}`)
  const token = signUp.session?.access_token
  if (!token) throw new Error(`no session for ${label} (email confirmation on?)`)

  const reg = await fetch(`${API}/auth/register`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ company_name: `RLS ${label} ${rand()}`, admin_name: `Owner ${label}`, email }),
  })
  const body = await reg.json()
  if (!reg.ok) throw new Error(`register ${label}: ${JSON.stringify(body)}`)

  // A client row for the tenant, created through the API (RLS-scoped insert).
  const cr = await fetch(`${API}/clients`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: `Client-${label}-${rand()}` }),
  })
  const clientRow = await cr.json()

  return { client, token, companyId: body.company_id, clientId: clientRow.id, clientName: clientRow.name }
}

const A = await makeStudio('A')
const B = await makeStudio('B')
console.log(`\nStudio A company=${A.companyId}\nStudio B company=${B.companyId}\n`)

// 1. Direct PostgREST with A's JWT: companies returns ONLY A's.
const aCompanies = await A.client.from('companies').select('id')
const aSeesOwn = aCompanies.data?.some((r) => r.id === A.companyId)
const aSeesB = aCompanies.data?.some((r) => r.id === B.companyId)
check('A can read its own company', !!aSeesOwn)
check('A CANNOT read company B (RLS)', !aSeesB)

// 2. clients table: A must not see B's client rows.
const aClients = await A.client.from('clients').select('id,name,company_id')
const leak = (aClients.data ?? []).filter((r) => r.company_id === B.companyId)
check('A CANNOT read B clients (RLS)', leak.length === 0)
check('A can read its own client', (aClients.data ?? []).some((r) => r.id === A.clientId))

// 3. users table: A must not see B's owner user.
const aUsers = await A.client.from('users').select('user_id,company_id')
const userLeak = (aUsers.data ?? []).some((r) => r.company_id === B.companyId)
check('A CANNOT read B users (RLS)', !userLeak)

// 4. Through the API list endpoint: A's /clients excludes B's client.
const aApi = await fetch(`${API}/clients`, { headers: { Authorization: `Bearer ${A.token}` } })
const aApiClients = await aApi.json()
const apiLeak = Array.isArray(aApiClients) && aApiClients.some((c) => c.name === B.clientName)
check('API /clients for A excludes B (RLS end-to-end)', !apiLeak)

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail === 0 ? 0 : 1)
