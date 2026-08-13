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
  check(
    `${label}: login returns an access + refresh pair`,
    login.status === 200 && !!login.json.access_token && !!login.json.refresh_token,
  )
  return { token: login.json.access_token, refresh: login.json.refresh_token, email }
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

// ── refresh + sign-out ────────────────────────────────────────
const rotated = await api('/auth/refresh', { method: 'POST', body: { refresh_token: a.refresh } })
check(
  'refresh: exchanges for a new pair',
  rotated.status === 200 && !!rotated.json.access_token && rotated.json.refresh_token !== a.refresh,
)

const refreshedCall = await api('/clients', { token: rotated.json.access_token })
check('refresh: the new access token works', refreshedCall.status === 200)

const spent = await api('/auth/refresh', { method: 'POST', body: { refresh_token: a.refresh } })
check('refresh: the spent token is refused (401)', spent.status === 401)

// Reuse revoked A's family, so its successor is dead too.
const afterReuse = await api('/auth/refresh', {
  method: 'POST',
  body: { refresh_token: rotated.json.refresh_token },
})
check('refresh: reuse kills the whole family (401)', afterReuse.status === 401)

// A fresh sign-in, then sign out everywhere.
const reLogin = await api('/auth/login', { method: 'POST', body: { email: a.email, password: 'Testpass12345!' } })
check('A: can sign in again after the family was revoked', reLogin.status === 200)

const logoutAll = await api('/auth/logout-all', { method: 'POST', token: reLogin.json.access_token })
check('logout-all: accepted', logoutAll.status === 200)

const deadAccess = await api('/clients', { token: reLogin.json.access_token })
check('logout-all: the access token is stranded (401)', deadAccess.status === 401)

const deadRefresh = await api('/auth/refresh', {
  method: 'POST',
  body: { refresh_token: reLogin.json.refresh_token },
})
check('logout-all: the refresh token is revoked (401)', deadRefresh.status === 401)

// ── password reset ────────────────────────────────────────────
// Unknown emails answer exactly like known ones (no account enumeration).
const unknown = await api('/auth/forgot-password', {
  method: 'POST',
  body: { email: `nobody-${rand()}@example.com` },
})
check(
  'forgot-password: unknown email still returns ok, no token',
  unknown.status === 200 && unknown.json.ok === true && !unknown.json.reset_token,
)

const forgot = await api('/auth/forgot-password', { method: 'POST', body: { email: b.email } })
check('forgot-password: issues a token for a real account', forgot.status === 200 && !!forgot.json.reset_token)

const NEW_PW = 'Newpass98765!'
const reset = await api('/auth/reset-password', {
  method: 'POST',
  body: { token: forgot.json.reset_token, password: NEW_PW },
})
check('reset-password: succeeds and signs in', reset.status === 200 && !!reset.json.access_token)

const replay = await api('/auth/reset-password', {
  method: 'POST',
  body: { token: forgot.json.reset_token, password: NEW_PW },
})
check('reset-password: the link is one-time (400)', replay.status === 400)

const oldPw = await api('/auth/login', { method: 'POST', body: { email: b.email, password: 'Testpass12345!' } })
check('B: the old password no longer works (401)', oldPw.status === 401)

const newPw = await api('/auth/login', { method: 'POST', body: { email: b.email, password: NEW_PW } })
check('B: the new password works', newPw.status === 200 && !!newPw.json.access_token)

// The session B held before the reset must be dead (stateless JWT + password_changed_at).
const stale = await api('/clients', { token: b.token })
check('B: the pre-reset session is rejected (401)', stale.status === 401)

// The token minted by the reset itself is still good.
const fresh = await api('/clients', { token: reset.json.access_token })
check('B: the post-reset session works', fresh.status === 200)

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
