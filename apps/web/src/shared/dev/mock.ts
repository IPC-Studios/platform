import type { ProjectDetail, ProjectListItem, SessionState } from '@ipc/contracts'
import type { Client } from '@ipc/contracts'

/**
 * DEV-ONLY UI preview mode. Enabled with VITE_MOCK=1. Supplies a fake session
 * and canned API responses so the whole authed UI is viewable without a live
 * Supabase/DB. Tree-shaken out of production builds (guarded by import.meta.env).
 */
export const MOCK_ENABLED = import.meta.env.DEV && import.meta.env.VITE_MOCK === '1'

/** Sentinel: this path is not mocked → fall through to the real fetch. */
export const NOT_MOCKED = Symbol('not-mocked')

/**
 * DEV knob for previewing the dashboard's Studio Setup Journey, which only
 * shows while a studio is still being set up. Append `?setup=fresh` for a brand
 * new studio (0 of 7) or `?setup=partial` for one three steps in. Without it the
 * fixtures are full, so the journey is correctly hidden.
 */
type SetupStage = 'fresh' | 'partial' | 'full'

function setupStage(): SetupStage {
  const v = new URLSearchParams(window.location.search).get('setup')
  return v === 'fresh' || v === 'partial' ? v : 'full'
}

/** Empty a fixture when the requested stage has not reached it yet. */
function atStage<T>(rows: T[], presentFrom: 'partial' | 'full'): T[] {
  const stage = setupStage()
  if (stage === 'full') return rows
  return stage === 'partial' && presentFrom === 'partial' ? rows : []
}

/** Deterministic uuid from a short seed so fixtures satisfy uuid contracts. */
const uid = (n: number) => `${n.toString(16).padStart(8, '0')}-0000-4000-8000-000000000000`

const CLIENT = { sharma: uid(0xc1), verma: uid(0xc2), nova: uid(0xc3) }
const PROJ = { p1: uid(0x91), p2: uid(0x92), p3: uid(0x93), p4: uid(0x94) }

export const mockSession: SessionState = {
  user_id: uid(1),
  company_id: uid(0xaa),
  role: 'super_admin',
  is_owner: true,
  is_platform_admin: true,
  display_name: 'Demo Owner',
  email: 'owner@demostudio.in',
  plan_gate: 'active',
  plan_expiry: '2027-01-01T00:00:00Z',
  permissions: [],
}

/** Directory rows carry a lot of nullable columns; only name the ones that vary. */
function member(
  user_id: string,
  name: string,
  email: string | null,
  role: string,
  over: Partial<{
    phone: string | null
    alternate_phone: string | null
    status: string
    engagement_type: string | null
    login_enabled: boolean
    salary: number | null
    address: string | null
    created_at: string
    role_ids: string[]
    role_names: string[]
  }> = {},
) {
  return {
    user_id,
    name,
    email,
    role,
    phone: null,
    alternate_phone: null,
    status: 'active',
    engagement_type: null,
    login_enabled: true,
    salary: null,
    address: null,
    created_at: '2026-05-01T10:00:00Z',
    role_ids: [],
    role_names: [],
    ...over,
  }
}

const clients: Client[] = [
  fakeClient(CLIENT.sharma, 'Sharma Family', '9876543210'),
  fakeClient(CLIENT.verma, 'Verma Weddings', '9812345678'),
  fakeClient(CLIENT.nova, 'Nova Events', '9900112233'),
]

const projects: ProjectListItem[] = [
  fakeProject(PROJ.p1, 'Sharma Wedding', 'active', 'Sharma Family', 185000, 227000),
  fakeProject(PROJ.p2, 'Verma Reception', 'on_hold', 'Verma Weddings', 90000, 90000),
  fakeProject(PROJ.p3, 'Nova Product Shoot', 'completed', 'Nova Events', 60000, 72000),
  fakeProject(PROJ.p4, 'Kapoor Pre-Wedding', 'active', 'Sharma Family', 45000, 45000),
]

const projectDetail: ProjectDetail = {
  id: PROJ.p1,
  name: 'Sharma Wedding',
  status: 'active',
  client_id: CLIENT.sharma,
  package_cost: 185000,
  additional_deliverables_cost: 42000,
  total_cost: 227000,
  show_quotation: true,
  created_at: '2026-06-01T10:00:00Z',
  deliverables: [
    delv(uid(0xd1), 'Wedding album (40 sheets)', 'client', true, 30000),
    delv(uid(0xd2), 'Highlight film', 'client', true, 12000),
    delv(uid(0xd3), 'Raw footage archive', 'internal', false, 0),
  ],
  payments: [
    { id: uid(0xf1), amount: 100000, paid_on: '2026-06-02', mode: 'upi', reference: 'TXN9931' },
    { id: uid(0xf2), amount: 50000, paid_on: '2026-07-15', mode: 'bank', reference: 'NEFT5521' },
  ],
}

const boardTasks = [
  boardTask(uid(0x1a), 'Cull & select — Sharma', 'to_do', 'high', 'Sharma Wedding', 0, {
    due_date: '2026-08-28',
    description: 'First pass, then hand to the editor.',
  }),
  boardTask(uid(0x1b), 'Colour grade film', 'to_do', 'urgent', 'Sharma Wedding', 1, {
    due_date: '2026-09-01',
    assignee_names: [],
  }),
  boardTask(uid(0x1c), 'Album layout', 'in_progress', 'medium', 'Sharma Wedding', 0),
  boardTask(uid(0x1d), 'Edit teaser', 'in_progress', 'high', 'Verma Reception', 1),
  boardTask(uid(0x1e), 'Client review call', 'completed', 'low', 'Nova Product Shoot', 0),
  boardTask(uid(0x1f), 'Retouch product set', 'completed', 'medium', 'Nova Product Shoot', 1),
]

/** Canned response for a path, or NOT_MOCKED to fall through to the network. */
/**
 * Theme is the one fixture that must REMEMBER a write: the picker saves, then
 * refetches, so a hard-coded reply would snap the selection back and make the
 * palette impossible to try in preview mode.
 */
/** Mirrors the theme fixture: a write here has to survive the refetch. */
const profileFx = {
  name: 'Demo Owner',
  email: 'owner@demostudio.in',
  phone: '9800000000',
  role: 'super_admin',
  status: 'active',
}

const themeState = { preset_key: 'ipc_classic', font_key: null as string | null, color_scheme: 'light' }

export function mockResponse(path: string, method: string, body?: unknown): unknown {
  if (method === 'GET' && path === '/auth/session') return mockSession
  if (method === 'POST' && path === '/auth/forgot-password') return { ok: true }
  if (method === 'POST' && (path === '/auth/logout' || path === '/auth/logout-all'))
    return { ok: true }
  if (method === 'POST' && /^\/team\/members\/[^/]+\/reset-password$/.test(path))
    return { ok: true }
  if (method === 'POST' && path === '/auth/reset-password')
    return {
      access_token: 'mock-token',
      refresh_token: 'mock-refresh',
      token_type: 'bearer',
      expires_in: 1800,
    }
  if (method === 'GET' && path === '/clients') return atStage(clients, 'partial')
  if (method === 'GET' && path === '/projects') return atStage(projects, 'partial')
  if (method === 'GET' && path === '/projects/tracking') return atStage(trackingRows, 'partial')
  if (method === 'GET' && path.startsWith('/projects/')) return projectDetail
  if (method === 'GET' && (path === '/tasks/board' || path.startsWith('/tasks/board')))
    return atStage(boardTasks, 'full')
  if (method === 'GET' && (path === '/tasks' || path === '/tasks/my')) return atStage(boardTasks, 'full')
  if (method === 'GET' && path === '/tasks/bundles') return atStage(bundlesFx, 'partial')
  if (method === 'POST' && path === '/tasks/bundles') return { id: uid(0xd8) }
  if (method === 'DELETE' && path.startsWith('/tasks/bundles/')) return {}
  if (method === 'POST' && /\/tasks\/bundles\/[^/]+\/apply$/.test(path)) return { created: 4 }
  if (method === 'GET' && (path === '/shoots' || path.startsWith('/shoots?'))) return shootsFx
  if (method === 'POST' && path === '/shoots') return { id: uid(0x5c) }
  if (method === 'PATCH' && path.startsWith('/shoots/')) return {}
  if (method === 'POST' && path === '/projects') return { id: PROJ.p1 }
  if (method === 'PATCH' && path.startsWith('/projects/')) return {}
  if (method === 'DELETE' && path.startsWith('/projects/')) return {}
  if (method === 'POST' && /^\/projects\/[^/]+\/(deliverables|payments)$/.test(path)) return {}
  if (method === 'POST' && path === '/clients') return fakeClient(uid(0xc9), 'New Client', null)
  if (method === 'GET' && path === '/team/members') return atStage(members, 'partial')
  if (method === 'GET' && path === '/team/directory') return atStage(directory, 'partial')
  if (method === 'GET' && path === '/team/roles') return atStage(employeeRoles, 'partial')
  if (method === 'POST' && path === '/team/roles')
    return { id: uid(0xfa), type_name: 'New Role', role_code: 'new_role', member_count: 0 }
  if ((method === 'PATCH' || method === 'DELETE') && path.startsWith('/team/roles/')) return { ok: true }
  if (method === 'PATCH' && /^\/team\/members\/[^/]+\/roles$/.test(path)) return { ok: true }
  if (method === 'POST' && path === '/team/members')
    return { user_id: uid(0xd5), temp_password: null }
  if ((method === 'PATCH' || method === 'DELETE') && /^\/team\/members\/[^/]+$/.test(path))
    return { ok: true }
  if (method === 'GET' && path === '/team/invitations') return atStage(invitations, 'partial')
  if (method === 'POST' && path === '/team/invitations')
    return {
      id: uid(0xfb),
      invite_link: 'http://localhost:5173/accept-invite?token=mock-invite-token',
      expires_at: '2026-09-08T10:00:00Z',
    }
  if (method === 'POST' && /^\/team\/invitations\/[^/]+\/resend$/.test(path))
    return {
      id: uid(0xfb),
      invite_link: 'http://localhost:5173/accept-invite?token=mock-invite-token-2',
      expires_at: '2026-09-08T10:00:00Z',
    }
  if (method === 'DELETE' && path.startsWith('/team/invitations/')) return { ok: true }
  if (method === 'GET' && path.startsWith('/auth/invite'))
    return {
      email: 'meera@crew.in',
      name: 'Meera Iyer',
      company_name: 'Demo Studio',
      role: 'employee',
      expires_at: '2026-09-06T10:00:00Z',
    }
  if (method === 'POST' && path === '/auth/accept-invite')
    return {
      access_token: 'mock-token',
      refresh_token: 'mock-refresh',
      token_type: 'bearer',
      expires_in: 1800,
    }
  if (method === 'GET' && path === '/settings/profile') return profileFx
  if (method === 'PATCH' && path === '/settings/profile') {
    Object.assign(profileFx, body as Record<string, unknown>)
    return { ...profileFx }
  }
  if (method === 'GET' && path === '/settings/company') return companyFx
  if (method === 'PATCH' && path === '/settings/company') return companyFx
  if (method === 'GET' && path === '/settings/theme') return { ...themeState }
  if (method === 'PATCH' && path === '/settings/theme') {
    Object.assign(themeState, body as Record<string, unknown>)
    return { ...themeState }
  }
  if (method === 'GET' && path === '/allocation') return atStage(slots, 'full')
  if (method === 'POST' && path === '/allocation') return { id: uid(0x5a) }
  if (method === 'GET' && (path === '/data' || path.startsWith('/data?')))
    return atStage(dataRecords, 'full')
  if (method === 'POST' && path.includes('/verify')) return {}
  if (method === 'POST' && path === '/data') return dataRecords[0]
  if (method === 'GET' && path === '/work/submissions') return workSubs
  if (method === 'POST' && path === '/work/submissions') return { id: uid(0x8a) }
  if (method === 'GET' && path === '/billing/states') return states
  if (method === 'GET' && path === '/billing/invoices') return atStage(invoices2, 'full')
  if (method === 'GET' && path.startsWith('/billing/invoices/')) return invoiceDetailFx
  if (method === 'POST' && path === '/billing/invoices')
    return { id: uid(0x9a), invoice_number: 'INV-0004' }
  if (method === 'POST' && path.includes('/payments')) return {}
  if (method === 'GET' && path === '/financials/expenses') return expensesFx
  if (method === 'POST' && path === '/financials/expenses') return expensesFx[0]
  if (method === 'GET' && path === '/financials/projects') return projectFin
  if (method === 'GET' && /^\/crm\/leads\/[^/]+\/timeline/.test(path)) return crmTimelineFx
  if (method === 'GET' && /^\/crm\/activities\/[^/]+\/ics$/.test(path)) return NOT_MOCKED
  if (method === 'POST' && path === '/crm/activities/call') return { activity: crmActivitiesFx[0], placed: false, provider: 'manual', call_sid: null, dial_url: 'tel:+919876500001' }
  if (method === 'POST' && path === '/crm/activities/meeting') return { activity: crmActivitiesFx[2], ics_url: '/crm/activities/x/ics' }
  if (method === 'POST' && path === '/crm/activities/email/sync') return { status: 'not_configured', provider: null, fetched: 0, imported: 0, unmatched: 0, message: 'Mailbox sync is not configured in preview.' }
  if (method === 'GET' && path.startsWith('/crm/activities')) return path.includes('open_tasks=1') ? crmActivitiesFx.filter((x) => x.type === 'task' && !x.done_at) : crmActivitiesFx
  if (method === 'POST' && path === '/crm/activities') return { ...crmActivitiesFx[0], id: uid(0xe9), ...(body as Record<string, unknown>) }
  if ((method === 'PATCH' || method === 'DELETE') && path.startsWith('/crm/activities/')) return {}
  if (method === 'GET' && path === '/crm/integrations') return crmIntegrationsFx
  if (method === 'PUT' && path.startsWith('/crm/integrations/')) return {}
  if (method === 'GET' && path === '/crm/pipelines') return crmPipelinesFx
  if (method === 'POST' && path === '/crm/pipelines') return { ...crmPipelinesFx[0], id: uid(0xd8), name: String((body as { name?: string }).name ?? 'Pipeline'), is_default: false }
  if ((method === 'PATCH' || method === 'DELETE') && path.startsWith('/crm/pipelines/') && !path.endsWith('/stages')) return {}
  if (method === 'POST' && /^\/crm\/pipelines\/[^/]+\/stages$/.test(path)) return crmPipelinesFx[0]
  if ((method === 'PATCH' || method === 'DELETE') && path.startsWith('/crm/stages/')) return {}
  if (method === 'POST' && /^\/crm\/leads\/[^/]+\/stage$/.test(path))
    return { status: 'contacted', stage_id: String((body as { stage_id?: string }).stage_id ?? STAGE.contacted) }
  if (method === 'GET' && path === '/crm/lost-reasons') return crmLostReasonsFx
  if (method === 'POST' && path === '/crm/lost-reasons') return { id: uid(0xd9), label: String((body as { label?: string }).label ?? 'Other'), position: 9, is_active: true }
  if ((method === 'PATCH' || method === 'DELETE') && path.startsWith('/crm/lost-reasons/')) return {}
  if (method === 'GET' && path.startsWith('/crm/contacts/')) return crmContactsFx[0]
  if (method === 'GET' && path.startsWith('/crm/contacts')) return crmContactsFx
  if (method === 'POST' && path === '/crm/contacts') return { ...crmContactsFx[0], id: uid(0xda), ...(body as Record<string, unknown>) }
  if (method === 'PATCH' && path.startsWith('/crm/contacts/')) return {}
  if (method === 'GET' && path.startsWith('/crm/companies/')) return crmCompaniesFx[0]
  if (method === 'GET' && path.startsWith('/crm/companies')) return crmCompaniesFx
  if (method === 'POST' && path === '/crm/companies') return { ...crmCompaniesFx[0], id: uid(0xdb), ...(body as Record<string, unknown>) }
  if (method === 'PATCH' && path.startsWith('/crm/companies/')) return {}
  if (method === 'GET' && path.startsWith('/crm/forecast')) return crmForecastFx
  if (method === 'PATCH' && path.startsWith('/crm/views/')) return {}
  if (method === 'GET' && (path === '/crm/leads' || path.startsWith('/crm/leads?')))
    return atStage(dealLeads(), 'partial')
  if (method === 'GET' && /^\/crm\/leads\/[^/]+\/events$/.test(path)) return crmEventsFx
  if (method === 'POST' && /^\/crm\/leads\/[^/]+\/send-template$/.test(path))
    return { url: 'https://wa.me/919876543210?text=Hi', rendered: 'Hi', delivery: 'link' }
  if (method === 'POST' && path === '/crm/leads/bulk') return { updated: 0, previous: [] }
  if (method === 'POST' && path === '/crm/leads/bulk/undo') return { restored: 0 }
  if (method === 'POST' && path === '/crm/leads/merge') return { merged: 1 }
  if (method === 'POST' && path === '/crm/leads/unmerge') return { restored: 1 }
  if (method === 'GET' && path === '/crm/duplicates') return []
  if (method === 'GET' && path === '/crm/templates') return crmTemplatesFx
  if (method === 'POST' && path === '/crm/templates')
    return { ...crmTemplatesFx[0], id: uid(0xc8), ...(body as Record<string, unknown>) }
  if (method === 'DELETE' && path.startsWith('/crm/templates/')) return {}
  if (method === 'GET' && path === '/crm/workflows') return crmWorkflowsFx
  if (method === 'POST' && path === '/crm/workflows') return { ...crmWorkflowsFx[0], id: uid(0xf5), ...(body as Record<string, unknown>), steps: crmWorkflowsFx[0]!.steps }
  if (method === 'POST' && /^\/crm\/workflows\/[^/]+\/enroll$/.test(path)) return { enrolled: 1 }
  if (method === 'GET' && /^\/crm\/workflows\/[^/]+\/enrollments$/.test(path)) return crmEnrollmentsFx
  if (method === 'GET' && /^\/crm\/leads\/[^/]+\/enrollments$/.test(path)) return crmEnrollmentsFx.filter((e) => e.status === 'active')
  if ((method === 'PATCH' || method === 'DELETE') && path.startsWith('/crm/workflows/')) return {}
  if (method === 'POST' && path.startsWith('/crm/enrollments/')) return {}
  if (method === 'GET' && path === '/crm/scoring-rules') return crmScoringFx
  if (method === 'POST' && path === '/crm/scoring-rules') return { ...crmScoringFx[0], id: uid(0xf6), ...(body as Record<string, unknown>) }
  if ((method === 'PATCH' || method === 'DELETE') && path.startsWith('/crm/scoring-rules/')) return {}
  if (method === 'POST' && path === '/crm/scoring/recompute') return { rescored: 4 }
  if (method === 'GET' && path.startsWith('/crm/stats')) return crmStatsFx
  if (method === 'GET' && path.startsWith('/crm/team-stats')) return crmTeamStatsFx
  if (method === 'POST' && path === '/crm/imports/preview') return crmPreviewFx
  if (method === 'POST' && path === '/crm/imports/commit')
    return { created: 1, skipped: 0, invalid: 0, ids: [uid(0xbe)] }
  if (method === 'POST' && path === '/crm/distribution') return { id: uid(0xca) }
  if ((method === 'PATCH' || method === 'DELETE') && path.startsWith('/crm/distribution/')) return {}
  if (method === 'GET' && path === '/crm/views') return crmViewsFx
  if (method === 'POST' && path === '/crm/views')
    return { ...crmViewsFx[0], id: uid(0xcb), ...(body as Record<string, unknown>) }
  if (method === 'DELETE' && path.startsWith('/crm/views/')) return {}
  if (method === 'GET' && path === '/crm/settings') return { sla_hours: 24, hot_score: 60 }
  if (method === 'PATCH' && path === '/crm/settings') return { sla_hours: 24, hot_score: 60, ...(body as Record<string, unknown>) }
  if (method === 'GET' && path === '/crm/cadences') return crmCadencesFx
  if (method === 'POST' && path === '/crm/cadences') return { id: uid(0xcc) }
  if ((method === 'PATCH' || method === 'DELETE') && path.startsWith('/crm/cadences/')) return {}
  if (method === 'GET' && /^\/crm\/leads\/[^/]+\/cadence$/.test(path)) return null
  if (method === 'POST' && /^\/crm\/leads\/[^/]+\/cadence$/.test(path)) return { next_at: '2026-09-07T04:30:00Z' }
  if (method === 'DELETE' && /^\/crm\/leads\/[^/]+\/cadence$/.test(path)) return {}
  if (method === 'POST' && /^\/crm\/leads\/[^/]+\/convert$/.test(path))
    return { client_id: CLIENT.sharma, project_id: PROJ.p1 }
  if (method === 'GET' && path.startsWith('/cron/runs')) return cronRunsFx
  if (method === 'GET' && path.startsWith('/settings/audit')) return auditFx
  if (method === 'POST' && path === '/auth/change-password')
    return { access_token: 'mock-token', refresh_token: 'mock-refresh', token_type: 'bearer', expires_in: 1800 }
  if (method === 'GET' && path === '/shoots/my') return shootsFx
  if (method === 'PUT' && path.startsWith('/hr/attendance/')) return { id: uid(0xc2) }
  if (method === 'GET' && path === '/crm/distribution') return atStage(distributionFx, 'partial')
  if (method === 'GET' && path === '/crm/sources') return atStage(sourcesFx, 'partial')
  if (method === 'POST' && path === '/crm/sources')
    return {
      ...sourcesFx[0],
      id: uid(0xc7),
      ...(body as Record<string, unknown>),
      source_key: 'wf_' + '0'.repeat(29) + 'new',
      lead_count: 0,
      last_lead_at: null,
    }
  if ((method === 'PATCH' || method === 'DELETE') && path.startsWith('/crm/sources/')) return {}
  if (method === 'POST' && path === '/crm/leads')
    return {
      ...dealLeads()[3],
      id: uid(0xbf),
      ...(body as Record<string, unknown>),
      status: 'new',
      assignee_name: null,
    }
  if (method === 'PATCH' && path.startsWith('/crm/leads/')) return {}
  if (method === 'GET' && path === '/hr/attendance/my') return attendanceFx
  if (method === 'GET' && path === '/hr/location')
    return { lat: 19.076, lng: 72.8777, radius_m: 150, timezone: 'Asia/Kolkata' }
  if (method === 'PATCH' && path === '/hr/location')
    return { ...(body as Record<string, unknown>), timezone: 'Asia/Kolkata' }
  if (method === 'GET' && path.startsWith('/hr/attendance?')) return atStage(rosterFx, 'partial')
  if (method === 'POST' && path === '/hr/check-out') return { id: uid(0xc1) }
  if (method === 'POST' && path === '/hr/check-in') return { id: uid(0xc0) }
  if (method === 'GET' && path === '/notifications') return notifs
  if (method === 'POST' && path.includes('/notifications/')) return {}
  if (method === 'GET' && path === '/subscription/plans') return plansFx
  if (method === 'POST' && path === '/subscription/order')
    return { order_id: uid(0xd0), amount: 5900 }
  if (method === 'POST' && path === '/subscription/activate')
    return { duplicate: false, expires_at: '2027-01-01T00:00:00Z' }
  if (method === 'GET' && path.startsWith('/public/terms/'))
    return {
      body: 'These are the terms of service for your photography package. By clicking "I agree" you accept the scope, payment schedule, and delivery timelines outlined in your quotation.',
    }
  if (method === 'POST' && path.includes('/terms/') && path.endsWith('/ack')) return { ok: true }
  if (method === 'POST' && path === '/tasks/generate') return { created: 3 }
  if (method === 'GET' && path === '/platform/studios') return platformStudiosFx
  if (method === 'GET' && path === '/platform/usage') return platformUsageFx
  if (method === 'POST' && /^\/platform\/studios\/[^/]+\/plan$/.test(path)) return { ok: true }
  // 204-style writes: return an empty object so the schema (z.any) passes.
  if (method === 'POST' && path === '/tasks/board/order') return {}
  if (method === 'PATCH' && path.includes('/status')) return {}
  return NOT_MOCKED
}

const platformStudiosFx = [
  {
    id: uid(0xaa),
    name: 'Demo Studio',
    owner_email: 'owner@demostudio.in',
    plan_gate: 'active',
    plan_expiry: '2027-01-01T00:00:00Z',
    user_count: 4,
    project_count: 4,
    created_at: '2026-05-01T10:00:00Z',
  },
  {
    id: uid(0xab),
    name: 'Lens & Light',
    owner_email: 'hi@lenslight.in',
    plan_gate: 'grandfathered',
    plan_expiry: null,
    user_count: 2,
    project_count: 7,
    created_at: '2026-06-12T10:00:00Z',
  },
  {
    id: uid(0xac),
    name: 'Frame Story',
    owner_email: 'team@framestory.in',
    plan_gate: 'grace',
    plan_expiry: '2026-08-01T00:00:00Z',
    user_count: 6,
    project_count: 12,
    created_at: '2026-03-20T10:00:00Z',
  },
  {
    id: uid(0xad),
    name: 'Old Studio',
    owner_email: 'x@old.in',
    plan_gate: 'expired',
    plan_expiry: '2026-04-01T00:00:00Z',
    user_count: 1,
    project_count: 2,
    created_at: '2025-11-02T10:00:00Z',
  },
]

const platformUsageFx = {
  studio_count: 4,
  active_studio_count: 2,
  total_users: 13,
  revenue_last_30d: 17700,
}

const dataRecords = [
  {
    id: uid(0x71),
    data_label: 'CF Card A (Cam 1)',
    data_type: 'photo',
    primary_status: 'verified',
    backup_status: 'verified',
    card_count: 2,
    size_gb: 64.5,
    verified_at: '2026-07-02T09:00:00Z',
  },
  {
    id: uid(0x72),
    data_label: 'SD Card B (Cam 2)',
    data_type: 'photo',
    primary_status: 'copied',
    backup_status: 'pending',
    card_count: 1,
    size_gb: 32,
    verified_at: null,
  },
  {
    id: uid(0x73),
    data_label: 'Cinema drive',
    data_type: 'video',
    primary_status: 'copied',
    backup_status: 'copied',
    card_count: 4,
    size_gb: 512,
    verified_at: null,
  },
]

const plansFx = [
  { id: uid(0xe0), key: 'starter', name: 'Starter', price: 2000, billing_interval: 'monthly' },
  { id: uid(0xe1a), key: 'pro', name: 'Pro', price: 5000, billing_interval: 'monthly' },
  {
    id: uid(0xe2a),
    key: 'studio',
    name: 'Studio (Yearly)',
    price: 50000,
    billing_interval: 'yearly',
  },
]

const notifs = [
  {
    id: uid(0xf1),
    type: 'reminder',
    title: 'Call Priya about wedding date',
    body: null,
    read_at: null,
    created_at: '2026-07-06T06:00:00Z',
  },
  {
    id: uid(0xf2),
    type: 'work',
    title: 'Album v1 was approved',
    body: 'Great work',
    read_at: null,
    created_at: '2026-07-05T10:00:00Z',
  },
  {
    id: uid(0xf3),
    type: 'billing',
    title: 'INV-0001 is overdue',
    body: null,
    read_at: '2026-07-04T10:00:00Z',
    created_at: '2026-07-03T10:00:00Z',
  },
]

/** One of each shape the roster has to render: closed, still in, late, absent. */
const rosterFx = [
  {
    user_id: uid(0xe1),
    name: 'Rahul Sharma',
    email: 'rahul@demostudio.in',
    phone: '9811111111',
    engagement_type: 'in_house',
    status: 'present',
    check_in_at: '2026-09-01T03:34:00Z',
    check_out_at: '2026-09-01T12:04:00Z',
  },
  {
    user_id: uid(0xe3),
    name: 'Sana Khan',
    email: 'sana@demostudio.in',
    phone: '9833333333',
    engagement_type: 'in_house',
    status: 'present',
    check_in_at: '2026-09-01T04:02:00Z',
    check_out_at: null,
  },
  {
    user_id: uid(0xe2),
    name: 'Anita Desai',
    email: 'anita@demostudio.in',
    phone: null,
    engagement_type: 'freelancer',
    status: 'late',
    check_in_at: '2026-09-01T05:41:00Z',
    check_out_at: '2026-09-01T12:30:00Z',
  },
  {
    user_id: uid(0xe4),
    name: 'Imran Qureshi',
    email: null,
    phone: '9844444444',
    engagement_type: 'freelancer',
    status: 'absent',
    check_in_at: null,
    check_out_at: null,
  },
]

const attendanceFx = [
  {
    id: uid(0xd1),
    a_date: '2026-07-06',
    check_in_at: '2026-07-06T04:05:00Z',
    check_out_at: null,
    status: 'present',
  },
  {
    id: uid(0xd2),
    a_date: '2026-07-05',
    check_in_at: '2026-07-05T04:35:00Z',
    check_out_at: '2026-07-05T13:00:00Z',
    status: 'late',
  },
  { id: uid(0xd3), a_date: '2026-07-04', check_in_at: null, check_out_at: null, status: 'absent' },
]

/** Dates are relative to "now" so the due/overdue buckets are always live. */
const daysFromNow = (n: number, hour = 10) => {
  const at = new Date()
  at.setDate(at.getDate() + n)
  at.setHours(hour, 0, 0, 0)
  return at.toISOString()
}

const COMPANY = { verma: uid(0xde) }
const PIPELINE = uid(0xd0)
const STAGE = { new: uid(0xd1), contacted: uid(0xd2), qualified: uid(0xd3), proposal: uid(0xd4), won: uid(0xd5), lost: uid(0xd6) }
/** Deal fields for the fixtures above: a stage per status, a value on most. */
const STAGE_FOR: Record<string, string> = {
  new: STAGE.new,
  contacted: STAGE.contacted,
  qualified: STAGE.qualified,
  proposal_sent: STAGE.proposal,
  converted: STAGE.won,
  lost: STAGE.lost,
}
const withDeal = <T extends { status: string; name: string | null }>(l: T, i: number) => ({
  ...l,
  pipeline_id: PIPELINE,
  stage_id: STAGE_FOR[l.status] ?? STAGE.new,
  deal_value: i % 3 === 2 ? null : 60000 + i * 15000,
  close_date: i % 2 === 0 ? '2026-10-15' : null,
  title: i === 0 ? 'December wedding' : null,
  score: [72, 35, 10, 55, 20, 65][i % 6] ?? 0,
  crm_company_id: i === 1 ? COMPANY.verma : null,
  crm_company_name: i === 1 ? 'Verma Weddings' : null,
})
const dealLeads = () => rawLeads.map(withDeal)

const rawLeads = [
  {
    id: uid(0xb1),
    name: 'Priya & Arjun',
    phone: '9876500001',
    email: 'priya@x.in',
    source: 'facebook',
    status: 'new',
    assigned_to: uid(0xe1),
    assignee_name: 'Rahul',
    notes: 'Dec wedding, asked for two photographers.',
    follow_up_at: daysFromNow(-2),
    last_contacted_at: null,
    converted_at: null,
    is_hot: true,
    created_at: '2026-07-05T08:00:00Z',
  },
  {
    id: uid(0xb2),
    name: 'Meera',
    phone: '9876500002',
    email: null,
    source: 'webform',
    status: 'contacted',
    assigned_to: uid(0xe3),
    assignee_name: 'Sana',
    notes: null,
    follow_up_at: daysFromNow(0, 16),
    last_contacted_at: daysFromNow(-3),
    converted_at: null,
    is_hot: false,
    created_at: '2026-07-04T08:00:00Z',
  },
  {
    id: uid(0xb3),
    name: 'Corporate Event',
    phone: '9876500003',
    email: 'events@co.in',
    source: 'referral',
    status: 'proposal_sent',
    assigned_to: uid(0xe1),
    assignee_name: 'Rahul',
    notes: 'Quote sent for a two-day conference shoot.',
    follow_up_at: daysFromNow(4),
    last_contacted_at: daysFromNow(-5),
    converted_at: null,
    is_hot: false,
    created_at: '2026-07-03T08:00:00Z',
  },
  {
    id: uid(0xb4),
    name: 'Walk-in enquiry',
    phone: '9876500004',
    email: null,
    source: 'enquiry',
    status: 'new',
    assigned_to: null,
    assignee_name: null,
    notes: null,
    follow_up_at: null,
    last_contacted_at: null,
    converted_at: null,
    is_hot: false,
    created_at: '2026-07-02T08:00:00Z',
  },
  {
    id: uid(0xb5),
    name: 'Kapoor Family',
    phone: '9876500005',
    email: null,
    source: 'referral',
    status: 'converted',
    assigned_to: uid(0xe3),
    assignee_name: 'Sana',
    notes: 'Booked the pre-wedding package.',
    follow_up_at: null,
    last_contacted_at: daysFromNow(-12),
    converted_at: daysFromNow(-6),
    is_hot: false,
    created_at: '2026-06-20T08:00:00Z',
  },
]

const sourcesFx = [
  {
    id: uid(0xc5),
    label: 'Website contact form',
    source_key: 'wf_9f2c41ba7e5d4a1b8c3e6f0d2a4b7c91',
    kind: 'webform',
    is_active: true,
    created_at: '2026-06-01T10:00:00Z',
    lead_count: 2,
    last_lead_at: '2026-07-04T08:00:00Z',
  },
  {
    id: uid(0xc6),
    label: 'Meta — Wedding campaign',
    source_key: 'mt_3a7e91c05b2d4e6f8a1c3b5d7e9f0a2c',
    kind: 'meta',
    is_active: false,
    created_at: '2026-05-12T10:00:00Z',
    lead_count: 1,
    last_lead_at: '2026-07-05T08:00:00Z',
  },
]

const distributionFx = [
  { id: uid(0xba), user_id: uid(0xe1), user_name: 'Rahul Sharma', priority: 0, is_active: true, lead_count: 2 },
  { id: uid(0xbb), user_id: uid(0xe3), user_name: 'Sana Khan', priority: 1, is_active: true, lead_count: 1 },
]

const expensesFx = [
  {
    id: uid(0xa1),
    project_id: PROJ.p1,
    category: 'Travel',
    description: 'Outstation shoot',
    amount: 15000,
    expense_date: '2026-06-20',
    gst_treatment: 'non_gst',
    is_fixed_overhead: false,
  },
  {
    id: uid(0xa2),
    project_id: null,
    category: 'Rent',
    description: 'Studio rent',
    amount: 40000,
    expense_date: '2026-06-01',
    gst_treatment: 'gst_applicable',
    is_fixed_overhead: true,
  },
  {
    id: uid(0xa3),
    project_id: PROJ.p3,
    category: 'Props',
    description: 'Product staging',
    amount: 8000,
    expense_date: '2026-06-28',
    gst_treatment: 'non_gst',
    is_fixed_overhead: false,
  },
]

const projectFin = [
  {
    project_id: PROJ.p1,
    name: 'Sharma Wedding',
    revenue: 227000,
    received: 150000,
    direct_team_cost: 40000,
    project_expenses: 15000,
    gross_profit: 172000,
    balance_pending: 77000,
  },
  {
    project_id: PROJ.p3,
    name: 'Nova Product Shoot',
    revenue: 72000,
    received: 72000,
    direct_team_cost: 18000,
    project_expenses: 8000,
    gross_profit: 46000,
    balance_pending: 0,
  },
]

const invoiceDetailFx = {
  id: uid(0x91),
  invoice_number: 'INV-0001',
  invoice_date: '2026-06-10',
  status: 'partial',
  place_of_supply: '27',
  client_name: 'Sharma Family',
  subtotal: 120000,
  discount: 0,
  taxable: 120000,
  tax: 20400,
  total: 140400,
  amount_paid: 100000,
  balance_due: 40400,
  created_at: '2026-06-10T10:00:00Z',
  items: [
    {
      id: uid(0x9b1),
      description: 'Photography package',
      quantity: 1,
      rate: 100000,
      amount: 100000,
      gst_rate: 18,
      cgst: 9000,
      sgst: 9000,
      igst: 0,
    },
    {
      id: uid(0x9b2),
      description: 'Wedding album',
      quantity: 2,
      rate: 10000,
      amount: 20000,
      gst_rate: 12,
      cgst: 1200,
      sgst: 1200,
      igst: 0,
    },
  ],
  payments: [{ id: uid(0x9c1), amount: 100000, paid_on: '2026-06-12', mode: 'upi' }],
}

const states = [
  { code: '27', name: 'Maharashtra' },
  { code: '07', name: 'Delhi' },
  { code: '29', name: 'Karnataka' },
  { code: '33', name: 'Tamil Nadu' },
]

const invoices2 = [
  {
    id: uid(0x91),
    invoice_number: 'INV-0001',
    client_name: 'Sharma Family',
    invoice_date: '2026-06-10',
    total: 140400,
    balance_due: 40400,
    status: 'partial',
  },
  {
    id: uid(0x92),
    invoice_number: 'INV-0002',
    client_name: 'Verma Weddings',
    invoice_date: '2026-06-18',
    total: 90000,
    balance_due: 0,
    status: 'paid',
  },
  {
    id: uid(0x93),
    invoice_number: 'INV-0003',
    client_name: 'Nova Events',
    invoice_date: '2026-07-01',
    total: 72000,
    balance_due: 72000,
    status: 'sent',
  },
]

const workSubs = [
  {
    id: uid(0x81),
    project_id: PROJ.p1,
    task_id: null,
    submission_link: 'https://drive.google.com/album-v1',
    notes: 'First album cut',
    status: 'submitted',
    review_notes: null,
    created_at: '2026-07-03T08:00:00Z',
  },
  {
    id: uid(0x82),
    project_id: PROJ.p1,
    task_id: null,
    submission_link: 'https://drive.google.com/film-v2',
    notes: 'Highlight film',
    status: 'approved',
    review_notes: 'Great work',
    created_at: '2026-07-01T08:00:00Z',
  },
  {
    id: uid(0x83),
    project_id: PROJ.p2,
    task_id: null,
    submission_link: 'https://drive.google.com/teaser',
    notes: null,
    status: 'rejected',
    review_notes: 'Re-grade the outdoor shots',
    created_at: '2026-06-28T08:00:00Z',
  },
]

const members = [
  { user_id: uid(0xe1), name: 'Rahul (Photographer)', role: 'employee' },
  { user_id: uid(0xe2), name: 'Anita (Cinematographer)', role: 'employee' },
  { user_id: uid(0xe3), name: 'Sana (Editor)', role: 'manager' },
]

const bundlesFx = [
  {
    id: uid(0xd6),
    name: 'Wedding editing',
    items: [
      { id: uid(0xd61), title: 'Cull and select', priority: 'high', sort_order: 0 },
      { id: uid(0xd62), title: 'Colour grade', priority: 'medium', sort_order: 1 },
      { id: uid(0xd63), title: 'Album layout', priority: 'medium', sort_order: 2 },
      { id: uid(0xd64), title: 'Client review', priority: 'low', sort_order: 3 },
    ],
  },
  {
    id: uid(0xd7),
    name: 'Shoot preparation',
    items: [
      { id: uid(0xd71), title: 'Confirm call sheet', priority: 'urgent', sort_order: 0 },
      { id: uid(0xd72), title: 'Charge batteries and format cards', priority: 'high', sort_order: 1 },
    ],
  },
]

const shootsFx = [
  {
    id: uid(0x61),
    name: 'Engagement shoot',
    project_id: PROJ.p1,
    project_name: 'Sharma Wedding',
    shoot_date: '2026-08-10',
    location: 'Bandra, Mumbai',
    status: 'confirmed',
  },
  {
    id: uid(0x62),
    name: 'Wedding day',
    project_id: PROJ.p1,
    project_name: 'Sharma Wedding',
    shoot_date: '2026-08-22',
    location: 'Taj Lands End',
    status: 'planned',
  },
  {
    id: uid(0x63),
    name: 'Product set A',
    project_id: PROJ.p3,
    project_name: 'Nova Product Shoot',
    shoot_date: '2026-07-01',
    location: 'Studio',
    status: 'completed',
  },
]

const companyFx = {
  name: 'Demo Studio',
  legal_name: 'Demo Studio Pvt Ltd',
  display_name: 'Demo Studio',
  city: 'Mumbai',
  state: 'Maharashtra',
  country: 'India',
  website: 'https://demostudio.in',
  invoice_gst_number: '27ABCDE1234F1Z5',
}

const ROLE = { photographer: uid(0xf1), editor: uid(0xf2), drone: uid(0xf3) }

const employeeRoles = [
  { id: ROLE.photographer, type_name: 'Photographer', role_code: 'photographer', member_count: 2 },
  { id: ROLE.editor, type_name: 'Editor', role_code: 'editor', member_count: 1 },
  { id: ROLE.drone, type_name: 'Drone Operator', role_code: 'drone_operator', member_count: 1 },
]

/** One of each shape the directory has to render: owner, staff, freelancer, no-login. */
const directory = [
  member(uid(0x1), 'Demo Owner', 'owner@demostudio.in', 'super_admin', {
    phone: '9800000000',
    engagement_type: 'in_house',
    created_at: '2026-05-01T10:00:00Z',
  }),
  member(uid(0xe1), 'Rahul Sharma', 'rahul@demostudio.in', 'employee', {
    phone: '9811111111',
    engagement_type: 'in_house',
    salary: 45000,
    role_ids: [ROLE.photographer],
    role_names: ['Photographer'],
    created_at: '2026-05-14T10:00:00Z',
  }),
  member(uid(0xe2), 'Anita Desai', 'anita@demostudio.in', 'employee', {
    engagement_type: 'freelancer',
    salary: 12000,
    role_ids: [ROLE.photographer, ROLE.drone],
    role_names: ['Drone Operator', 'Photographer'],
    created_at: '2026-06-02T10:00:00Z',
  }),
  member(uid(0xe3), 'Sana Khan', 'sana@demostudio.in', 'manager', {
    phone: '9833333333',
    alternate_phone: '9822222222',
    engagement_type: 'in_house',
    salary: 68000,
    role_ids: [ROLE.editor],
    role_names: ['Editor'],
    created_at: '2026-06-20T10:00:00Z',
  }),
  member(uid(0xe4), 'Imran Qureshi', null, 'employee', {
    phone: '9844444444',
    engagement_type: 'freelancer',
    login_enabled: false,
    status: 'inactive',
    created_at: '2026-07-11T10:00:00Z',
  }),
]

const invitations = [
  {
    id: uid(0xf9),
    email: 'meera@crew.in',
    name: 'Meera Iyer',
    role: 'employee',
    expires_at: '2026-09-06T10:00:00Z',
    created_at: '2026-08-30T10:00:00Z',
    last_sent_at: '2026-08-30T10:00:00Z',
    send_count: 1,
    expired: false,
  },
]

/** Tracking rows: one burning, one late, one waiting, one stalled, one done. */
const trackingRows = [
  {
    id: PROJ.p1,
    name: 'Sharma Wedding',
    status: 'active',
    client_name: 'Sharma Family',
    total_cost: 227000,
    tasks_total: 8,
    tasks_done: 3,
    tasks_overdue: 2,
    deliverables_total: 3,
    deliverables_done: 1,
    data_records_total: 4,
    data_records_unverified: 3,
    pending_reviews: 1,
    shoots_total: 2,
    shoots_done: 2,
    next_shoot_date: null,
    last_activity_at: '2026-08-28T10:00:00Z',
  },
  {
    id: PROJ.p2,
    name: 'Verma Reception',
    status: 'on_hold',
    client_name: 'Verma Weddings',
    total_cost: 90000,
    tasks_total: 5,
    tasks_done: 2,
    tasks_overdue: 1,
    deliverables_total: 2,
    deliverables_done: 0,
    data_records_total: 2,
    data_records_unverified: 0,
    pending_reviews: 2,
    shoots_total: 1,
    shoots_done: 1,
    next_shoot_date: null,
    last_activity_at: '2026-08-20T10:00:00Z',
  },
  {
    id: PROJ.p3,
    name: 'Nova Product Shoot',
    status: 'completed',
    client_name: 'Nova Events',
    total_cost: 72000,
    tasks_total: 4,
    tasks_done: 4,
    tasks_overdue: 0,
    deliverables_total: 2,
    deliverables_done: 2,
    data_records_total: 3,
    data_records_unverified: 0,
    pending_reviews: 0,
    shoots_total: 1,
    shoots_done: 1,
    next_shoot_date: null,
    last_activity_at: '2026-08-15T10:00:00Z',
  },
  {
    id: PROJ.p4,
    name: 'Kapoor Pre-Wedding',
    status: 'active',
    client_name: 'Sharma Family',
    total_cost: 45000,
    tasks_total: 3,
    tasks_done: 1,
    tasks_overdue: 0,
    deliverables_total: 1,
    deliverables_done: 0,
    data_records_total: 0,
    data_records_unverified: 0,
    pending_reviews: 0,
    shoots_total: 2,
    shoots_done: 0,
    next_shoot_date: '2026-09-18',
    last_activity_at: '2026-08-31T10:00:00Z',
  },
]

const slots = [
  {
    id: uid(0x51),
    user_id: uid(0xe1),
    user_name: 'Rahul (Photographer)',
    shoot_id: null,
    service_name: 'Wedding day',
    start_at: '2026-07-01T04:30:00Z',
    end_at: '2026-07-01T16:30:00Z',
    status: 'booked',
    estimated_cost: 8000,
  },
  {
    id: uid(0x52),
    user_id: uid(0xe2),
    user_name: 'Anita (Cinematographer)',
    shoot_id: null,
    service_name: 'Reception',
    start_at: '2026-07-02T12:00:00Z',
    end_at: '2026-07-02T18:00:00Z',
    status: 'booked',
    estimated_cost: 10000,
  },
]

function boardTask(
  id: string,
  title: string,
  status: string,
  priority: string,
  project_name: string,
  sort_order: number,
  over: { due_date?: string | null; description?: string | null; assignee_names?: string[] } = {},
) {
  return {
    id,
    title,
    description: null,
    status,
    priority,
    due_date: null,
    project_id: PROJ.p1,
    project_name,
    assignee_names: ['Rahul Sharma'],
    sort_order,
    ...over,
  }
}

function fakeClient(id: string, name: string, phone: string | null): Client {
  return {
    id,
    company_id: mockSession.company_id,
    name,
    email: null,
    phone,
    alternate_phone: null,
    address: null,
    city: 'Mumbai',
    notes: null,
    created_at: '2026-05-01T10:00:00Z',
  }
}

function fakeProject(
  id: string,
  name: string,
  status: ProjectListItem['status'],
  client_name: string,
  pkg: number,
  total: number,
): ProjectListItem {
  return {
    id,
    name,
    status,
    client_id: CLIENT.sharma,
    client_name,
    package_cost: pkg,
    total_cost: total,
    created_at: '2026-06-01T10:00:00Z',
  }
}

function delv(
  id: string,
  title: string,
  visibility_scope: 'client' | 'internal',
  is_additional_charge: boolean,
  amount: number,
) {
  return {
    id,
    project_id: PROJ.p1,
    title,
    list_key: 'primary',
    is_additional_charge,
    additional_charge_amount: amount,
    visibility_scope,
    show_on_quotation: visibility_scope === 'client',
    start_rule: 'whole_project' as const,
    status: 'in_progress',
  }
}


const stageFx = (id: string, name: string, key: string, position: number, kind: 'open' | 'won' | 'lost', probability_default: number, deal_count: number) => ({
  id,
  pipeline_id: PIPELINE,
  name,
  key,
  position,
  kind,
  probability_default,
  wip_limit: key === 'proposal_sent' ? 5 : null,
  required_fields: key === 'proposal_sent' ? ['deal_value'] : [],
  deal_count,
})
const crmPipelinesFx = [
  {
    id: PIPELINE,
    name: 'Sales',
    is_default: true,
    position: 0,
    created_at: '2026-08-01T09:00:00Z',
    stages: [
      stageFx(STAGE.new, 'New', 'new', 0, 'open', 10, 1),
      stageFx(STAGE.contacted, 'Contacted', 'contacted', 1, 'open', 25, 1),
      stageFx(STAGE.qualified, 'Qualified', 'qualified', 2, 'open', 50, 1),
      stageFx(STAGE.proposal, 'Proposal sent', 'proposal_sent', 3, 'open', 75, 0),
      stageFx(STAGE.won, 'Won', 'converted', 4, 'won', 100, 1),
      stageFx(STAGE.lost, 'Lost', 'lost', 5, 'lost', 0, 0),
    ],
  },
]
const crmLostReasonsFx = [
  { id: uid(0xd7), label: 'Budget', position: 0, is_active: true },
  { id: uid(0xdc), label: 'Timing', position: 1, is_active: true },
  { id: uid(0xdd), label: 'Went elsewhere', position: 2, is_active: true },
]
const crmCompaniesFx = [
  {
    id: COMPANY.verma,
    name: 'Verma Weddings',
    domain: 'vermaweddings.in',
    phone: '9812345678',
    city: 'Pune',
    notes: null,
    owner_id: uid(1),
    owner_name: 'Demo Owner',
    is_archived: false,
    contact_count: 1,
    deal_count: 1,
    open_value: 90000,
    created_at: '2026-08-01T09:00:00Z',
  },
]
const crmContactsFx = [
  {
    id: uid(0xdf),
    name: 'Aanya Sharma',
    phone: '9876543210',
    email: 'aanya@example.in',
    lifecycle: 'lead',
    owner_id: uid(1),
    owner_name: 'Demo Owner',
    source: 'facebook',
    crm_company_id: null,
    crm_company_name: null,
    notes: null,
    is_archived: false,
    deal_count: 1,
    open_deal_count: 1,
    last_contacted_at: null,
    created_at: '2026-08-01T09:00:00Z',
  },
  {
    id: uid(0xe1),
    name: 'Rahul Verma',
    phone: '9812345678',
    email: null,
    lifecycle: 'customer',
    owner_id: uid(1),
    owner_name: 'Demo Owner',
    source: 'referral',
    crm_company_id: COMPANY.verma,
    crm_company_name: 'Verma Weddings',
    notes: 'Repeat client',
    is_archived: false,
    deal_count: 2,
    open_deal_count: 1,
    last_contacted_at: '2026-08-20T09:00:00Z',
    created_at: '2026-07-01T09:00:00Z',
  },
]
const crmForecastFx = {
  from: '2026-08-07',
  to: '2026-12-05',
  count: 3,
  total_value: 330000,
  weighted: 197500,
  won_value: 90000,
  open_value: 240000,
  by_stage: [
    { stage_id: STAGE.contacted, name: 'Contacted', kind: 'open', count: 1, total_value: 150000, weighted: 37500 },
    { stage_id: STAGE.qualified, name: 'Qualified', kind: 'open', count: 1, total_value: 90000, weighted: 45000 },
    { stage_id: STAGE.won, name: 'Won', kind: 'won', count: 1, total_value: 90000, weighted: 90000 },
  ],
  by_owner: [{ user_id: uid(1), name: 'Demo Owner', count: 3, total_value: 330000, weighted: 197500 }],
  by_month: [
    { month: '2026-09', count: 2, total_value: 240000, weighted: 82500 },
    { month: '2026-10', count: 1, total_value: 90000, weighted: 90000 },
  ],
}

const activityFx = (id: string, over: Partial<Record<string, unknown>>) => ({
  id,
  lead_id: uid(0xb1),
  lead_name: 'Priya & Arjun',
  contact_id: uid(0xdf),
  type: 'note',
  direction: 'none',
  subject: null,
  body: null,
  outcome: null,
  started_at: '2026-09-04T09:00:00Z',
  ended_at: null,
  duration_s: null,
  due_at: null,
  done_at: null,
  assigned_to: uid(1),
  assignee_name: 'Demo Owner',
  actor_id: uid(1),
  actor_name: 'Demo Owner',
  provider: 'manual',
  external_id: null,
  created_at: '2026-09-04T09:00:00Z',
  ...over,
})
const crmActivitiesFx = [
  activityFx(uid(0xe2), { type: 'call', direction: 'out', outcome: 'answered', duration_s: 660, body: 'Wants two photographers and a drone.' }),
  activityFx(uid(0xe3), { type: 'task', subject: 'Send the album mock-up', due_at: '2026-09-05T04:30:00Z', created_at: '2026-09-03T09:00:00Z' }),
  activityFx(uid(0xe4), { type: 'meeting', direction: 'out', subject: 'Venue recce', started_at: '2026-09-10T04:30:00Z', ended_at: '2026-09-10T05:30:00Z', created_at: '2026-09-02T09:00:00Z' }),
  activityFx(uid(0xe5), { type: 'whatsapp', direction: 'in', subject: 'Yes, Sunday works', provider: 'whatsapp', created_at: '2026-09-01T12:00:00Z', lead_id: uid(0xb2), lead_name: 'Meera' }),
]
const crmTimelineFx = {
  items: [
    ...crmActivitiesFx.filter((a) => a.lead_id === uid(0xb1)).map((a) => ({ kind: 'activity', at: a.created_at, activity: a })),
    { kind: 'event', at: '2026-08-01T09:00:00Z', event: { id: uid(0xe0), lead_id: uid(0xb1), from_status: null, to_status: 'new', actor_id: null, actor_name: null, note: 'arrived via facebook', created_at: '2026-08-01T09:00:00Z' } },
  ],
  next_cursor: null,
}
const crmIntegrationsFx = [
  { provider: 'gmail', status: 'not_configured', credentials_present: false, config: {}, last_error: null, last_sync_at: null, connected_by: null, updated_at: null },
  { provider: 'o365', status: 'not_configured', credentials_present: false, config: {}, last_error: null, last_sync_at: null, connected_by: null, updated_at: null },
  { provider: 'twilio', status: 'connected', credentials_present: true, config: {}, last_error: null, last_sync_at: null, connected_by: uid(1), updated_at: '2026-09-01T09:00:00Z' },
]

const crmEventsFx = [
  {
    id: uid(0xe0),
    lead_id: uid(0xb1),
    from_status: null,
    to_status: 'new',
    actor_id: null,
    actor_name: null,
    note: 'created',
    created_at: '2026-08-01T09:00:00Z',
  },
]

const crmTemplatesFx = [
  {
    id: uid(0xc5),
    name: 'First follow-up',
    body: 'Hi {{name}}, thanks for reaching out to {{studio}}!',
    kind: 'whatsapp',
    created_at: '2026-08-01T09:00:00Z',
  },
]

const WF = uid(0xf0)
const crmWorkflowsFx = [
  {
    id: WF,
    name: 'Facebook nurture',
    trigger: 'lead_created',
    condition: { source: 'facebook' },
    is_active: true,
    allow_reenroll: false,
    exit_on_reply: true,
    steps: [
      { id: uid(0xf1), step_no: 1, kind: 'action', config: { action: 'mark_hot' } },
      { id: uid(0xf2), step_no: 2, kind: 'delay', config: { amount: 1, unit: 'days' } },
      { id: uid(0xf3), step_no: 3, kind: 'branch', config: { conditions: [{ field: 'inbound_replies', op: 'gte', value: 1 }], yes_step: 5, no_step: 4 } },
      { id: uid(0xf4), step_no: 4, kind: 'action', config: { action: 'notify_assignee', note: 'No reply yet — call them.' } },
      { id: uid(0xf7), step_no: 5, kind: 'exit', config: {} },
    ],
    active_count: 1,
    completed_count: 3,
    errored_count: 0,
    last_enrolled_at: '2026-09-04T09:00:00Z',
    created_at: '2026-08-01T09:00:00Z',
  },
]
const crmEnrollmentsFx = [
  { id: uid(0xf8), workflow_id: WF, workflow_name: 'Facebook nurture', lead_id: uid(0xb1), lead_name: 'Priya & Arjun', current_step: 3, next_at: '2026-09-06T09:00:00Z', status: 'active', exit_reason: null, steps_run: 2, enrolled_at: '2026-09-04T09:00:00Z' },
  { id: uid(0xf9), workflow_id: WF, workflow_name: 'Facebook nurture', lead_id: uid(0xb2), lead_name: 'Meera', current_step: 5, next_at: null, status: 'completed', exit_reason: null, steps_run: 4, enrolled_at: '2026-08-20T09:00:00Z' },
]
const crmScoringFx = [
  { id: uid(0xfa), label: 'Has an email address', field: 'has_email', op: 'eq', value: true, points: 10, is_active: true, position: 0 },
  { id: uid(0xfb), label: 'Came by referral', field: 'source', op: 'eq', value: 'referral', points: 15, is_active: true, position: 1 },
  { id: uid(0xfc), label: 'Deal worth 50,000 or more', field: 'deal_value', op: 'gte', value: 50000, points: 20, is_active: true, position: 2 },
  { id: uid(0xfd), label: 'Has replied', field: 'inbound_replies', op: 'gte', value: 1, points: 25, is_active: true, position: 3 },
  { id: uid(0xfe), label: 'Gone quiet for 14 days', field: 'days_since_contact', op: 'gte', value: 14, points: -15, is_active: true, position: 6 },
]

const crmStatsFx = {
  from: '2026-08-01',
  to: '2026-08-31',
  total: 4,
  overdue: 1,
  uncontacted: 1,
  created: 4,
  won: 1,
  lost: 0,
  conversion_rate: 0.25,
  byStatus: { new: 1, contacted: 1, proposal_sent: 1, converted: 1 },
  bySource: { facebook: 2, enquiry: 2 },
}

const crmTeamStatsFx = [
  {
    user_id: uid(0xe1),
    user_name: 'Rahul',
    open: 2,
    overdue: 1,
    due_today: 0,
    uncontacted: 1,
    hot: 1,
    created: 2,
    won: 1,
    lost: 0,
    within_sla: 2,
    sla_hours: 24,
    avg_first_response_hours: 3.5,
  },
]

const crmPreviewFx = {
  columns: ['name', 'phone', 'email', 'notes'],
  rows: [
    {
      row: 2,
      name: 'Priya',
      phone: '9876543210',
      email: 'priya@test.in',
      source: 'manual',
      notes: 'Interested',
      valid: true,
      error: null,
      phone_norm: '919876543210',
      is_duplicate: false,
    },
  ],
  total: 1,
  valid: 1,
  duplicates: 0,
}

const cronRunsFx = [
  {
    id: uid(0xd9),
    job_name: 'reminder_cron',
    started_at: '2026-09-05T08:00:00Z',
    finished_at: '2026-09-05T08:00:01Z',
    dry_run: false,
    summary: { reminders_due: 2, notifications_created: 1 },
  },
  {
    id: uid(0xda),
    job_name: 'crm_followup_cron',
    started_at: '2026-09-05T08:00:01Z',
    finished_at: '2026-09-05T08:00:02Z',
    dry_run: false,
    summary: { overdue: 1, notified: 1, rules_applied: 0 },
  },
]

const auditFx = {
  items: [
    {
      id: uid(0xdb),
      actor_user_id: uid(1),
      actor_name: 'Demo Owner',
      action: 'company.update',
      entity_type: 'company',
      entity_id: uid(0xaa),
      before: { name: 'Demo' },
      after: { name: 'Demo Studio' },
      ip: '127.0.0.1',
      correlation_id: 'req-demo-1',
      created_at: '2026-09-05T07:30:00Z',
    },
  ],
  next_cursor: null,
}

const crmViewsFx = [
  {
    id: uid(0xca),
    name: 'My overdue',
    query: { search: '', filters: ['overdue'], status: 'all', assignee: 'all' },
    created_at: '2026-08-01T09:00:00Z',
  },
]

const crmCadencesFx = [
  {
    id: uid(0xcd),
    name: 'Wedding enquiry follow-up',
    is_active: true,
    steps: [
      { id: uid(0xce), step_no: 1, day_offset: 0, template_id: null, template_name: null, note: 'Call and confirm the date' },
      { id: uid(0xcf), step_no: 2, day_offset: 3, template_id: uid(0xc5), template_name: 'First follow-up', note: null },
    ],
    active_leads: 1,
    created_at: '2026-08-01T09:00:00Z',
  },
]
