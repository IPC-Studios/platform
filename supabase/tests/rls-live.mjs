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

// Malformed uuid filters are caller errors (422), never cast-error 500s.
const badUuid = await api('/team-terms/sends?shoot_id=nope', { token: a.token })
check('sends: malformed uuid filter is 422', badUuid.status === 422)

// The enquiry inbox pages instead of truncating at a fixed cap.
for (let i = 0; i < 3; i++) {
  await api('/enquiries', { token: a.token, method: 'POST', body: { name: `Paged ${i} ${rand()}` } })
}
const eqPage1 = await api('/enquiries?limit=2', { token: a.token })
const eqIds1 = new Set((eqPage1.json.items ?? []).map((e) => e.id))
check(
  'enquiries: first page carries a cursor',
  eqPage1.status === 200 && eqIds1.size === 2 && !!eqPage1.json.next_cursor,
)
const eqPage2 = await api(`/enquiries?limit=2&cursor=${encodeURIComponent(eqPage1.json.next_cursor)}`, {
  token: a.token,
})
const eqIds2 = new Set((eqPage2.json.items ?? []).map((e) => e.id))
const overlap = [...eqIds2].some((id) => eqIds1.has(id))
check(
  'enquiries: second page continues without overlap',
  eqPage2.status === 200 && eqIds2.size === 1 && !overlap && !eqPage2.json.next_cursor,
)

// Referral campaigns: create, then list -- the list handler's own summary
// query once referenced `status` with no FROM clause reaching the table it
// meant to aggregate, so this 400ed on every call, for every studio, the
// moment a campaign existed to summarize.
const campaign = await api('/referrals/campaigns', {
  token: a.token,
  method: 'POST',
  body: { name: `Referral ${rand()}`, reward_type: 'fixed', reward_value: 500 },
})
check('referrals: can create a campaign', campaign.status === 201 && !!campaign.json.id)
const campaignList = await api('/referrals/campaigns', { token: a.token })
check(
  'referrals: list loads and includes the new campaign',
  campaignList.status === 200 &&
    Array.isArray(campaignList.json.campaigns) &&
    campaignList.json.campaigns.some((c) => c.id === campaign.json.id) &&
    campaignList.json.summary.total_campaigns >= 1,
)

// Invoice templates: layout_json is a jsonb column written with a manual
// `${JSON.stringify(x)}::jsonb` cast instead of the driver's own sql.json()
// helper used everywhere else in this file for the same kind of param. That
// pattern double-encoded the value on write for most (not all -- data-
// dependent) requests, so the list endpoint's response-schema parse blew up
// with a 500 for every studio the moment more than one template existed.
// Create two (the first request alone didn't reproduce it live -- the bug
// was data/timing-dependent, not "always broken").
const template1 = await api('/billing/templates', {
  token: a.token,
  method: 'POST',
  body: { name: `Template ${rand()}`, layout_json: { header_text: 'From the studio' } },
})
const template2 = await api('/billing/templates', {
  token: a.token,
  method: 'POST',
  body: { name: `Template ${rand()}`, layout_json: { header_text: 'Second one' } },
})
check(
  'invoice templates: create returns the full row, not just an id',
  template1.status === 201 &&
    template1.json.layout_json?.header_text === 'From the studio' &&
    template2.status === 201 &&
    template2.json.layout_json?.header_text === 'Second one',
)
const templateList = await api('/billing/templates', { token: a.token })
const byId = new Map((templateList.json.items ?? []).map((t) => [t.id, t]))
check(
  'invoice templates: list loads and layout_json round-trips as an object for every row',
  templateList.status === 200 &&
    typeof byId.get(template1.json.id)?.layout_json === 'object' &&
    byId.get(template1.json.id)?.layout_json.header_text === 'From the studio' &&
    typeof byId.get(template2.json.id)?.layout_json === 'object' &&
    byId.get(template2.json.id)?.layout_json.header_text === 'Second one',
)

// Project templates: same double-encoding bug as invoice templates above --
// deliverables_json/shoots_json/tasks_json were written with a manual
// `${JSON.stringify(x)}::jsonb` cast instead of sql.json(), so every field
// came back as a string and the list 500ed for every studio once a template
// existed with more than a trivial payload.
const projectTemplate = await api('/projects/templates', {
  token: a.token,
  method: 'POST',
  body: {
    name: `Template ${rand()}`,
    deliverables_json: [{ name: 'Edited album', quantity: 1 }],
    shoots_json: [{ name: 'Engagement', kind: 'pre-wedding' }],
    tasks_json: [{ title: 'Cull photos' }],
  },
})
check('project templates: create returns an id', projectTemplate.status === 201 && !!projectTemplate.json.id)
const projectTemplateList = await api('/projects/templates', { token: a.token })
const pt = (projectTemplateList.json.items ?? []).find((t) => t.id === projectTemplate.json.id)
check(
  'project templates: list loads and every jsonb field round-trips as an array',
  projectTemplateList.status === 200 &&
    Array.isArray(pt?.deliverables_json) &&
    pt.deliverables_json[0]?.name === 'Edited album' &&
    Array.isArray(pt?.shoots_json) &&
    pt.shoots_json[0]?.name === 'Engagement' &&
    Array.isArray(pt?.tasks_json) &&
    pt.tasks_json[0]?.title === 'Cull photos',
)

// Numeric query params must survive driver serialization (regression: custom
// pg serializers once returned numbers unchanged and every LIMIT query died
// with ERR_INVALID_ARG_TYPE in production while string-only routes stayed up).
const auditPage = await api('/settings/audit?limit=1', { token: a.token })
check('audit: numeric limit param works (200)', auditPage.status === 200)
const cronHistory = await api('/cron/runs?limit=1', { token: a.token })
check('cron: numeric limit param works (200)', cronHistory.status === 200)

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

// That replay landed inside the 60s grace window, where a spent token means
// "two tabs raced", not theft — so the successor must still work. Revocation on
// STALE reuse is covered by the pglite suite, which can age the row.
const afterReuse = await api('/auth/refresh', {
  method: 'POST',
  body: { refresh_token: rotated.json.refresh_token },
})
check('refresh: a racing replay does not kill the family', afterReuse.status === 200)

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
