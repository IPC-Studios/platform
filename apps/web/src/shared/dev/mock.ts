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
  if (method === 'POST' && path === '/clients') return fakeClient(uid(0xc9), 'New Client', null)
  if (method === 'POST' && path === '/tasks/generate') return { created: 3 }
  // 204-style writes: return an empty object so the schema (z.any) passes.
  if (method === 'POST' && path === '/tasks/board/order') return {}
  if (method === 'PATCH' && path.includes('/status')) return {}
  return NOT_MOCKED
}

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
