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

/** Deterministic uuid from a short seed so fixtures satisfy uuid contracts. */
const uid = (n: number) => `${n.toString(16).padStart(8, '0')}-0000-4000-8000-000000000000`

const CLIENT = { sharma: uid(0xc1), verma: uid(0xc2), nova: uid(0xc3) }
const PROJ = { p1: uid(0x91), p2: uid(0x92), p3: uid(0x93), p4: uid(0x94) }

export const mockSession: SessionState = {
  user_id: uid(1),
  company_id: uid(0xaa),
  role: 'super_admin',
  is_owner: true,
  display_name: 'Demo Owner',
  email: 'owner@demostudio.in',
  plan_gate: 'active',
  plan_expiry: '2027-01-01T00:00:00Z',
  permissions: [],
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
  boardTask(uid(0x1a), 'Cull & select — Sharma', 'to_do', 'high', 'Sharma Wedding', 0),
  boardTask(uid(0x1b), 'Colour grade film', 'to_do', 'urgent', 'Sharma Wedding', 1),
  boardTask(uid(0x1c), 'Album layout', 'in_progress', 'medium', 'Sharma Wedding', 0),
  boardTask(uid(0x1d), 'Edit teaser', 'in_progress', 'high', 'Verma Reception', 1),
  boardTask(uid(0x1e), 'Client review call', 'completed', 'low', 'Nova Product Shoot', 0),
  boardTask(uid(0x1f), 'Retouch product set', 'completed', 'medium', 'Nova Product Shoot', 1),
]

/** Canned response for a path, or NOT_MOCKED to fall through to the network. */
export function mockResponse(path: string, method: string): unknown {
  if (method === 'GET' && path === '/auth/session') return mockSession
  if (method === 'GET' && path === '/clients') return clients
  if (method === 'GET' && path === '/projects') return projects
  if (method === 'GET' && path.startsWith('/projects/')) return projectDetail
  if (method === 'GET' && (path === '/tasks/board' || path.startsWith('/tasks/board'))) return boardTasks
  if (method === 'GET' && (path === '/tasks' || path === '/tasks/my')) return boardTasks
  if (method === 'POST' && path === '/projects') return { id: PROJ.p1 }
  if (method === 'PATCH' && path.startsWith('/projects/')) return {}
  if (method === 'DELETE' && path.startsWith('/projects/')) return {}
  if (method === 'POST' && /^\/projects\/[^/]+\/(deliverables|payments)$/.test(path)) return {}
  if (method === 'POST' && path === '/clients') return fakeClient(uid(0xc9), 'New Client', null)
  if (method === 'GET' && path === '/team/members') return members
  if (method === 'GET' && path === '/team/directory') return directory
  if (method === 'POST' && path === '/team/members') return { user_id: uid(0xd5), temp_password: 'Xy8kLm2Qp4A1!' }
  if (method === 'GET' && path === '/settings/company') return companyFx
  if (method === 'PATCH' && path === '/settings/company') return companyFx
  if (method === 'GET' && path === '/settings/theme') return { preset_key: 'indigo', color_scheme: 'light' }
  if (method === 'PATCH' && path === '/settings/theme') return { preset_key: 'indigo', color_scheme: 'light' }
  if (method === 'GET' && path === '/allocation') return slots
  if (method === 'POST' && path === '/allocation') return { id: uid(0x5a) }
  if (method === 'GET' && (path === '/data' || path.startsWith('/data?'))) return dataRecords
  if (method === 'POST' && path.includes('/verify')) return {}
  if (method === 'POST' && path === '/data') return dataRecords[0]
  if (method === 'GET' && path === '/work/submissions') return workSubs
  if (method === 'POST' && path === '/work/submissions') return { id: uid(0x8a) }
  if (method === 'GET' && path === '/billing/states') return states
  if (method === 'GET' && path === '/billing/invoices') return invoices2
  if (method === 'POST' && path === '/billing/invoices') return { id: uid(0x9a), invoice_number: 'INV-0004' }
  if (method === 'POST' && path.includes('/payments')) return {}
  if (method === 'GET' && path === '/financials/expenses') return expensesFx
  if (method === 'POST' && path === '/financials/expenses') return expensesFx[0]
  if (method === 'GET' && path === '/financials/projects') return projectFin
  if (method === 'GET' && path === '/crm/leads') return leads
  if (method === 'PATCH' && path.startsWith('/crm/leads/')) return {}
  if (method === 'GET' && path === '/hr/attendance/my') return attendanceFx
  if (method === 'GET' && path === '/hr/location') return { lat: 19.076, lng: 72.8777, radius_m: 150 }
  if (method === 'POST' && path === '/hr/check-in') return { id: uid(0xc0) }
  if (method === 'GET' && path === '/notifications') return notifs
  if (method === 'POST' && path.includes('/notifications/')) return {}
  if (method === 'GET' && path === '/subscription/plans') return plansFx
  if (method === 'POST' && path === '/subscription/order') return { order_id: uid(0xd0), amount: 5900 }
  if (method === 'POST' && path === '/subscription/activate') return { duplicate: false, expires_at: '2027-01-01T00:00:00Z' }
  if (method === 'GET' && path.startsWith('/public/terms/')) return { body: 'These are the terms of service for your photography package. By clicking "I agree" you accept the scope, payment schedule, and delivery timelines outlined in your quotation.' }
  if (method === 'POST' && path.includes('/terms/') && path.endsWith('/ack')) return { ok: true }
  if (method === 'POST' && path === '/tasks/generate') return { created: 3 }
  // 204-style writes: return an empty object so the schema (z.any) passes.
  if (method === 'POST' && path === '/tasks/board/order') return {}
  if (method === 'PATCH' && path.includes('/status')) return {}
  return NOT_MOCKED
}

const dataRecords = [
  { id: uid(0x71), data_label: 'CF Card A (Cam 1)', data_type: 'photo', primary_status: 'verified', backup_status: 'verified', card_count: 2, size_gb: 64.5, verified_at: '2026-07-02T09:00:00Z' },
  { id: uid(0x72), data_label: 'SD Card B (Cam 2)', data_type: 'photo', primary_status: 'copied', backup_status: 'pending', card_count: 1, size_gb: 32, verified_at: null },
  { id: uid(0x73), data_label: 'Cinema drive', data_type: 'video', primary_status: 'copied', backup_status: 'copied', card_count: 4, size_gb: 512, verified_at: null },
]

const plansFx = [
  { id: uid(0xe0), key: 'starter', name: 'Starter', price: 2000, billing_interval: 'monthly' },
  { id: uid(0xe1a), key: 'pro', name: 'Pro', price: 5000, billing_interval: 'monthly' },
  { id: uid(0xe2a), key: 'studio', name: 'Studio (Yearly)', price: 50000, billing_interval: 'yearly' },
]

const notifs = [
  { id: uid(0xf1), type: 'reminder', title: 'Call Priya about wedding date', body: null, read_at: null, created_at: '2026-07-06T06:00:00Z' },
  { id: uid(0xf2), type: 'work', title: 'Album v1 was approved', body: 'Great work', read_at: null, created_at: '2026-07-05T10:00:00Z' },
  { id: uid(0xf3), type: 'billing', title: 'INV-0001 is overdue', body: null, read_at: '2026-07-04T10:00:00Z', created_at: '2026-07-03T10:00:00Z' },
]

const attendanceFx = [
  { id: uid(0xd1), a_date: '2026-07-06', check_in_at: '2026-07-06T04:05:00Z', check_out_at: null, status: 'present' },
  { id: uid(0xd2), a_date: '2026-07-05', check_in_at: '2026-07-05T04:35:00Z', check_out_at: '2026-07-05T13:00:00Z', status: 'late' },
  { id: uid(0xd3), a_date: '2026-07-04', check_in_at: null, check_out_at: null, status: 'absent' },
]

const leads = [
  { id: uid(0xb1), name: 'Priya & Arjun', phone: '9876500001', email: 'priya@x.in', source: 'facebook', status: 'new', assigned_to: uid(0xe1), assignee_name: 'Rahul', created_at: '2026-07-05T08:00:00Z' },
  { id: uid(0xb2), name: 'Meera', phone: '9876500002', email: null, source: 'webform', status: 'contacted', assigned_to: uid(0xe3), assignee_name: 'Sana', created_at: '2026-07-04T08:00:00Z' },
  { id: uid(0xb3), name: 'Corporate Event', phone: '9876500003', email: 'events@co.in', source: 'referral', status: 'qualified', assigned_to: uid(0xe1), assignee_name: 'Rahul', created_at: '2026-07-03T08:00:00Z' },
  { id: uid(0xb4), name: 'Kunal', phone: '9876500004', email: null, source: 'facebook', status: 'converted', assigned_to: uid(0xe3), assignee_name: 'Sana', created_at: '2026-07-01T08:00:00Z' },
  { id: uid(0xb5), name: 'Old enquiry', phone: '9876500005', email: null, source: 'enquiry', status: 'lost', assigned_to: null, assignee_name: null, created_at: '2026-06-20T08:00:00Z' },
]

const expensesFx = [
  { id: uid(0xa1), project_id: PROJ.p1, category: 'Travel', description: 'Outstation shoot', amount: 15000, expense_date: '2026-06-20', gst_treatment: 'non_gst', is_fixed_overhead: false },
  { id: uid(0xa2), project_id: null, category: 'Rent', description: 'Studio rent', amount: 40000, expense_date: '2026-06-01', gst_treatment: 'gst_applicable', is_fixed_overhead: true },
  { id: uid(0xa3), project_id: PROJ.p3, category: 'Props', description: 'Product staging', amount: 8000, expense_date: '2026-06-28', gst_treatment: 'non_gst', is_fixed_overhead: false },
]

const projectFin = [
  { project_id: PROJ.p1, name: 'Sharma Wedding', revenue: 227000, received: 150000, direct_team_cost: 40000, project_expenses: 15000, gross_profit: 172000, balance_pending: 77000 },
  { project_id: PROJ.p3, name: 'Nova Product Shoot', revenue: 72000, received: 72000, direct_team_cost: 18000, project_expenses: 8000, gross_profit: 46000, balance_pending: 0 },
]

const states = [
  { code: '27', name: 'Maharashtra' },
  { code: '07', name: 'Delhi' },
  { code: '29', name: 'Karnataka' },
  { code: '33', name: 'Tamil Nadu' },
]

const invoices2 = [
  { id: uid(0x91), invoice_number: 'INV-0001', client_name: 'Sharma Family', invoice_date: '2026-06-10', total: 140400, balance_due: 40400, status: 'partial' },
  { id: uid(0x92), invoice_number: 'INV-0002', client_name: 'Verma Weddings', invoice_date: '2026-06-18', total: 90000, balance_due: 0, status: 'paid' },
  { id: uid(0x93), invoice_number: 'INV-0003', client_name: 'Nova Events', invoice_date: '2026-07-01', total: 72000, balance_due: 72000, status: 'sent' },
]

const workSubs = [
  { id: uid(0x81), project_id: PROJ.p1, task_id: null, submission_link: 'https://drive.google.com/album-v1', notes: 'First album cut', status: 'submitted', review_notes: null, created_at: '2026-07-03T08:00:00Z' },
  { id: uid(0x82), project_id: PROJ.p1, task_id: null, submission_link: 'https://drive.google.com/film-v2', notes: 'Highlight film', status: 'approved', review_notes: 'Great work', created_at: '2026-07-01T08:00:00Z' },
  { id: uid(0x83), project_id: PROJ.p2, task_id: null, submission_link: 'https://drive.google.com/teaser', notes: null, status: 'rejected', review_notes: 'Re-grade the outdoor shots', created_at: '2026-06-28T08:00:00Z' },
]

const members = [
  { user_id: uid(0xe1), name: 'Rahul (Photographer)', role: 'employee' },
  { user_id: uid(0xe2), name: 'Anita (Cinematographer)', role: 'employee' },
  { user_id: uid(0xe3), name: 'Sana (Editor)', role: 'manager' },
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

const directory = [
  { user_id: uid(0x1), name: 'Demo Owner', email: 'owner@demostudio.in', role: 'super_admin', phone: '9800000000', status: 'active' },
  { user_id: uid(0xe1), name: 'Rahul Sharma', email: 'rahul@demostudio.in', role: 'employee', phone: '9811111111', status: 'active' },
  { user_id: uid(0xe2), name: 'Anita Desai', email: 'anita@demostudio.in', role: 'employee', phone: null, status: 'active' },
  { user_id: uid(0xe3), name: 'Sana Khan', email: 'sana@demostudio.in', role: 'manager', phone: '9833333333', status: 'active' },
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
) {
  return { id, title, status, priority, due_date: null, project_id: PROJ.p1, project_name, sort_order }
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
