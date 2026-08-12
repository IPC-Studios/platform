// Live end-to-end verification against a REAL self-hosted stack (Postgres + API).
// Exercises the whole path pglite can't: self-issued JWT auth + the withUser
// SET-ROLE/GUC transaction model enforcing RLS on plain Postgres. Proves a user
// in studio A cannot read studio B's data. Creates two throwaway studios.
//
// Run it AFTER `docker compose up` on the VPS (or any host with the API up):
//   API_URL=https://api.yourstudio.in bun supabase/tests/rls-live.mjs
const API = (process.env.API_URL ?? '').replace(/\/+$/, '')
if (!API) {
  console.error('Set API_URL (e.g. https://api.yourstudio.in)')
  process.exit(2)
}

const rand = () => Math.random().toString(36).slice(2, 10)
let pass = 0
let fail = 0
const check = (name, ok) => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`)
  ok ? pass++ : fail++
}

async function api(path, { token, method = 'GET', body } = {}) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body === undefined ? null : JSON.stringify(body),
  })
  const json = await res.json().catch(() => ({}))
  return { status: res.status, json }
}

async function makeStudio(label) {
  const email = `rls-${label}-${rand()}@example.com`
  const reg = await api('/auth/register', {
    method: 'POST',
    body: {
      company_name: `RLS ${label} ${rand()}`,
      admin_name: `Owner ${label}`,
      email,
      password: 'Testpass12345!',
    },
  })
  // Register requires email verification; off-production it returns the token.
  if (reg.status !== 200 || !reg.json.verification_token) {
    throw new Error(`register ${label}: ${reg.status} ${JSON.stringify(reg.json)}`)
  }

  // Login is refused until verified.
  const blocked = await api('/auth/login', { method: 'POST', body: { email, password: 'Testpass12345!' } })
  check(`${label}: login blocked before verification (403)`, blocked.status === 403)

  const verified = await api('/auth/verify', { method: 'POST', body: { token: reg.json.verification_token } })
  check(`${label}: verify returns a token`, verified.status === 200 && !!verified.json.access_token)

  // Password login now works.
  const login = await api('/auth/login', { method: 'POST', body: { email, password: 'Testpass12345!' } })
  check(`${label}: login works after verification`, login.status === 200 && !!login.json.access_token)
  return { token: login.json.access_token, email }
}

const a = await makeStudio('A')
const b = await makeStudio('B')

// Studio A creates a client.
const created = await api('/clients', {
  token: a.token,
  method: 'POST',
  body: { name: `A Client ${rand()}` },
})
check('A: can create a client', created.status === 201 && !!created.json.id)
const aClientId = created.json.id

// Studio A sees its own client.
const aList = await api('/clients', { token: a.token })
check('A: sees its own client', Array.isArray(aList.json) && aList.json.some((c) => c.id === aClientId))

// Studio B must NOT see A's client (RLS).
const bList = await api('/clients', { token: b.token })
check(
  "B: list excludes A's client (cross-tenant RLS)",
  Array.isArray(bList.json) && !bList.json.some((c) => c.id === aClientId),
)

// Studio B cannot fetch A's client by id.
const bGet = await api(`/clients/${aClientId}`, { token: b.token })
check("B: cannot fetch A's client by id (404)", bGet.status === 404)

// No token → unauthorized.
const anon = await api('/clients')
check('anon: rejected without a token', anon.status === 401)

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
