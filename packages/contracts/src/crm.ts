import { z } from 'zod'
import { uuid, isoDate, isoDateTime } from './shared/primitives'

export const leadStatus = z.enum([
  'new',
  'contacted',
  'qualified',
  'proposal_sent',
  'converted',
  'lost',
])
export type LeadStatus = z.infer<typeof leadStatus>

export const leadSource = z.enum(['facebook', 'webform', 'referral', 'manual', 'enquiry'])
export type LeadSource = z.infer<typeof leadSource>

export const crmLead = z.object({
  id: uuid,
  name: z.string().nullable(),
  phone: z.string().nullable(),
  email: z.string().nullable(),
  source: leadSource,
  status: leadStatus,
  assigned_to: uuid.nullable(),
  assignee_name: z.string().nullable(),
  notes: z.string().nullable(),
  /** The next promised contact. Null means nobody has agreed to call back. */
  follow_up_at: isoDateTime.nullable(),
  last_contacted_at: isoDateTime.nullable(),
  converted_at: isoDateTime.nullable(),
  is_hot: z.boolean(),
  /** Hidden from the working lists; still counted in history and reports. */
  is_archived: z.boolean().default(false),
  /** Set when this row was folded into another by a merge. */
  merged_into: uuid.nullable().default(null),
  /** The project this lead became, once converted. */
  converted_project_id: uuid.nullable().default(null),
  /** Deal value in INR (for forecast). */
  deal_value: z.number().nullable().default(null),
  probability: z.number().int().min(0).max(100).nullable().default(null),
  lost_reason: z.string().nullable().default(null),
  sla_due_at: isoDateTime.nullable().default(null),
  created_at: isoDateTime,
})
export type CrmLead = z.infer<typeof crmLead>

/** GET /crm/leads query. */
export const leadsQuery = z.object({
  include_archived: z
    .union([z.literal('1'), z.literal('0'), z.literal('true'), z.literal('false')])
    .optional()
    .transform((v) => v === '1' || v === 'true'),
  limit: z.coerce.number().int().min(1).max(5000).default(2000),
})
export type LeadsQuery = z.infer<typeof leadsQuery>

/** A move to lost is only valid with its reason — mirrors the DB trigger. */
const lostNeedsReason = (v: { status?: string | undefined; lost_reason?: string | null | undefined }): boolean =>
  v.status !== 'lost' || (typeof v.lost_reason === 'string' && v.lost_reason.length > 0)

export const updateLeadRequest = z
  .object({
    name: z.string().trim().max(160).nullable().optional(),
    phone: z.string().trim().max(30).nullable().optional(),
    email: z.string().trim().max(200).nullable().optional(),
    status: leadStatus.optional(),
    assigned_to: uuid.nullable().optional(),
    notes: z.string().max(4000).nullable().optional(),
    follow_up_at: isoDateTime.nullable().optional(),
    is_hot: z.boolean().optional(),
    is_archived: z.boolean().optional(),
    deal_value: z.number().min(0).max(1_00_00_000).nullable().optional(),
    probability: z.number().int().min(0).max(100).nullable().optional(),
    lost_reason: z.string().trim().min(3).max(500).nullable().optional(),
  })
  .refine(lostNeedsReason, {
    message: 'Tell us why it was lost (3+ chars).',
    path: ['lost_reason'],
  })
export type UpdateLeadRequest = z.infer<typeof updateLeadRequest>

/** Public webhook body (Meta / web form). */
export const captureLeadRequest = z.object({
  name: z.string().max(160).optional(),
  phone: z.string().max(30),
  email: z.string().max(200).optional(),
  meta: z.record(z.unknown()).optional(),
})
export type CaptureLeadRequest = z.infer<typeof captureLeadRequest>

/** Adding a lead by hand. The phone is the identity — everything else can wait. */
export const createLeadRequest = z.object({
  name: z.string().trim().max(160).optional(),
  phone: z.string().trim().min(6).max(30),
  email: z.string().trim().max(200).optional(),
  source: leadSource.default('manual'),
  notes: z.string().max(2000).optional(),
  assigned_to: uuid.nullable().optional(),
  follow_up_at: isoDateTime.nullable().optional(),
  deal_value: z.number().min(0).max(1_00_00_000).optional(),
  probability: z.number().int().min(0).max(100).optional(),
})
export type CreateLeadRequest = z.infer<typeof createLeadRequest>

/** One member of the round-robin rota new leads are handed to. */
export const distributionRule = z.object({
  id: uuid,
  user_id: uuid,
  user_name: z.string().nullable(),
  priority: z.number().int(),
  is_active: z.boolean(),
  lead_count: z.number().int(),
})
export type DistributionRule = z.infer<typeof distributionRule>

export const updateDistributionRequest = z.object({
  priority: z.number().int().min(0).max(100).optional(),
  is_active: z.boolean().optional(),
})
export type UpdateDistributionRequest = z.infer<typeof updateDistributionRequest>

export const createDistributionRequest = z.object({
  user_id: uuid,
  priority: z.number().int().min(0).max(100).default(0),
})
export type CreateDistributionRequest = z.infer<typeof createDistributionRequest>

/**
 * A place leads arrive from. The key is the credential the webhook is called
 * with, so it is minted server-side and only ever shown to the studio.
 */
export const leadSourceKind = z.enum(['webform', 'meta'])
export type LeadSourceKind = z.infer<typeof leadSourceKind>

export const leadSourceRow = z.object({
  id: uuid,
  label: z.string().nullable(),
  source_key: z.string(),
  kind: leadSourceKind,
  is_active: z.boolean(),
  created_at: isoDateTime,
  lead_count: z.number().int(),
  last_lead_at: isoDateTime.nullable(),
})
export type LeadSourceRow = z.infer<typeof leadSourceRow>

export const createLeadSourceRequest = z.object({
  label: z.string().trim().min(2).max(80),
  kind: leadSourceKind.default('webform'),
})
export type CreateLeadSourceRequest = z.infer<typeof createLeadSourceRequest>

export const updateLeadSourceRequest = z.object({
  label: z.string().trim().min(2).max(80).optional(),
  is_active: z.boolean().optional(),
})
export type UpdateLeadSourceRequest = z.infer<typeof updateLeadSourceRequest>

/** Audit trail for a lead - every status/patch carries who and when. */
export const leadEvent = z.object({
  id: uuid,
  lead_id: uuid,
  from_status: leadStatus.nullable(),
  to_status: leadStatus.nullable(),
  actor_id: uuid.nullable(),
  actor_name: z.string().nullable(),
  note: z.string().nullable(),
  created_at: isoDateTime,
})
export type LeadEvent = z.infer<typeof leadEvent>

// ── bulk edits ────────────────────────────────────────────────
export const bulkLeadPatch = z.object({
  ids: z.array(uuid).min(1).max(200),
  patch: z
    .object({
      status: leadStatus.optional(),
      assigned_to: uuid.nullable().optional(),
      is_hot: z.boolean().optional(),
      follow_up_at: isoDateTime.nullable().optional(),
      is_archived: z.boolean().optional(),
      lost_reason: z.string().trim().min(3).max(500).nullable().optional(),
    })
    .refine((p) => Object.keys(p).length > 0, 'Nothing to change.')
    .refine(lostNeedsReason, {
      message: 'Tell us why it was lost (3+ chars).',
      path: ['lost_reason'],
    }),
})
export type BulkLeadPatch = z.infer<typeof bulkLeadPatch>

/** What each lead looked like before a bulk edit — the undo payload. */
export const leadSnapshot = z.object({
  id: uuid,
  status: leadStatus,
  assigned_to: uuid.nullable(),
  is_hot: z.boolean(),
  follow_up_at: isoDateTime.nullable(),
  is_archived: z.boolean(),
  lost_reason: z.string().nullable(),
})
export type LeadSnapshot = z.infer<typeof leadSnapshot>

export const bulkPatchResponse = z.object({
  updated: z.number().int(),
  previous: z.array(leadSnapshot),
})
export type BulkPatchResponse = z.infer<typeof bulkPatchResponse>

export const bulkUndoRequest = z.object({ previous: z.array(leadSnapshot).min(1).max(200) })
export type BulkUndoRequest = z.infer<typeof bulkUndoRequest>

export const bulkUndoResponse = z.object({ restored: z.number().int() })
export type BulkUndoResponse = z.infer<typeof bulkUndoResponse>

// ── duplicates ────────────────────────────────────────────────
export const duplicateLead = z.object({
  id: uuid,
  name: z.string().nullable(),
  phone: z.string().nullable(),
  status: leadStatus,
  source: leadSource,
  notes: z.string().nullable(),
  created_at: isoDateTime,
})
export const duplicateGroup = z.object({
  phone_norm: z.string(),
  lead_ids: z.array(uuid),
  lead_count: z.number().int(),
  leads: z.array(duplicateLead),
})
export type DuplicateGroup = z.infer<typeof duplicateGroup>

export const mergeLeadsRequest = z.object({
  survivor_id: uuid,
  duplicate_ids: z.array(uuid).min(1).max(20),
})
export type MergeLeadsRequest = z.infer<typeof mergeLeadsRequest>

export const mergeLeadsResponse = z.object({ merged: z.number().int() })
export type MergeLeadsResponse = z.infer<typeof mergeLeadsResponse>

export const unmergeLeadsRequest = z.object({ survivor_id: uuid })
export const unmergeLeadsResponse = z.object({ restored: z.number().int() })

// ── CSV import ────────────────────────────────────────────────
export const csvImportPreviewRequest = z.object({
  csv: z.string().min(1).max(500_000),
})
export type CsvImportPreviewRequest = z.infer<typeof csvImportPreviewRequest>

export const csvImportRow = z.object({
  row: z.number().int(),
  name: z.string().nullable(),
  phone: z.string().nullable(),
  email: z.string().nullable(),
  source: leadSource,
  notes: z.string().nullable(),
  valid: z.boolean(),
  error: z.string().nullable(),
  phone_norm: z.string().nullable(),
  is_duplicate: z.boolean(),
})
export type CsvImportRow = z.infer<typeof csvImportRow>

export const csvImportPreviewResponse = z.object({
  columns: z.array(z.string()),
  rows: z.array(csvImportRow),
  total: z.number().int(),
  valid: z.number().int(),
  duplicates: z.number().int(),
})
export type CsvImportPreviewResponse = z.infer<typeof csvImportPreviewResponse>

export const csvImportCommitRequest = z.object({
  rows: z
    .array(
      z.object({
        name: z.string().max(160).nullable().optional(),
        phone: z.string().min(6).max(30),
        email: z.string().max(200).nullable().optional(),
        source: leadSource.default('manual'),
        notes: z.string().max(2000).nullable().optional(),
      }),
    )
    .min(1)
    .max(500),
  skip_duplicates: z.boolean().default(true),
})
export type CsvImportCommitRequest = z.infer<typeof csvImportCommitRequest>

export const csvImportCommitResponse = z.object({
  created: z.number().int(),
  skipped: z.number().int(),
  invalid: z.number().int(),
  ids: z.array(uuid),
})
export type CsvImportCommitResponse = z.infer<typeof csvImportCommitResponse>

// ── templates ─────────────────────────────────────────────────
export const templateKind = z.enum(['whatsapp', 'email', 'note'])
export type TemplateKind = z.infer<typeof templateKind>

export const crmTemplate = z.object({
  id: uuid,
  name: z.string(),
  body: z.string(),
  kind: templateKind,
  created_at: isoDateTime,
})
export type CrmTemplate = z.infer<typeof crmTemplate>

export const createTemplateRequest = z.object({
  name: z.string().trim().min(2).max(80),
  body: z.string().trim().min(2).max(2000),
  kind: templateKind.default('whatsapp'),
})
export type CreateTemplateRequest = z.infer<typeof createTemplateRequest>

/**
 * Sending a template to one lead. The server renders the body with the lead's
 * fields, records the contact on the lead's history, and hands back the link
 * that opens WhatsApp or the mail client with the message already filled in.
 */
export const sendTemplateRequest = z.object({
  template_id: uuid,
  channel: z.enum(['whatsapp', 'email']),
})
export type SendTemplateRequest = z.infer<typeof sendTemplateRequest>

export const sendTemplateResponse = z.object({
  /** A link to open (wa.me / mailto:), or null when the API delivered it itself. */
  url: z.string().nullable(),
  rendered: z.string(),
  /** 'api' = sent by the WhatsApp Cloud API; 'link' = opens the person's own app. */
  delivery: z.enum(['api', 'link']),
})
export type SendTemplateResponse = z.infer<typeof sendTemplateResponse>

// ── reports ───────────────────────────────────────────────────
export const crmStatsQuery = z.object({
  from: isoDate,
  to: isoDate,
})
export type CrmStatsQuery = z.infer<typeof crmStatsQuery>

export const crmStats = z.object({
  from: isoDate,
  to: isoDate,
  total: z.number().int(),
  overdue: z.number().int(),
  uncontacted: z.number().int(),
  created: z.number().int(),
  won: z.number().int(),
  lost: z.number().int(),
  conversion_rate: z.number(),
  byStatus: z.record(z.string(), z.number().int()),
  bySource: z.record(z.string(), z.number().int()),
})
export type CrmStats = z.infer<typeof crmStats>

export const crmTeamStatsRow = z.object({
  user_id: uuid,
  user_name: z.string(),
  open: z.number().int(),
  overdue: z.number().int(),
  due_today: z.number().int(),
  uncontacted: z.number().int(),
  hot: z.number().int(),
  created: z.number().int(),
  won: z.number().int(),
  lost: z.number().int(),
  /** Leads created in the range that were first contacted within the SLA. */
  within_sla: z.number().int(),
  sla_hours: z.number().int(),
  avg_first_response_hours: z.number().nullable(),
})
export type CrmTeamStatsRow = z.infer<typeof crmTeamStatsRow>

// ── automations ───────────────────────────────────────────────
export const automationTrigger = z.enum(['lead_created', 'stage_changed', 'follow_up_overdue'])
export type AutomationTrigger = z.infer<typeof automationTrigger>

export const automationAction = z.enum([
  'assign_to',
  'set_follow_up_days',
  'mark_hot',
  'add_note',
  'notify_assignee',
  'start_cadence',
])
export type AutomationAction = z.infer<typeof automationAction>

export const automationCondition = z.object({
  source: leadSource.optional(),
  to_status: leadStatus.optional(),
  from_status: leadStatus.optional(),
  is_hot: z.boolean().optional(),
})
export type AutomationCondition = z.infer<typeof automationCondition>

export const automationActionValue = z.object({
  user_id: uuid.optional(),
  days: z.number().int().min(0).max(365).optional(),
  note: z.string().trim().max(500).optional(),
  cadence_id: uuid.optional(),
})
export type AutomationActionValue = z.infer<typeof automationActionValue>

export const automationRule = z.object({
  id: uuid,
  name: z.string(),
  trigger: automationTrigger,
  condition: automationCondition,
  action: automationAction,
  action_value: automationActionValue,
  is_active: z.boolean(),
  created_at: isoDateTime,
})
export type AutomationRule = z.infer<typeof automationRule>

const actionNeedsValue = (v: { action: AutomationAction; action_value: AutomationActionValue }) => {
  if (v.action === 'assign_to') return !!v.action_value.user_id
  if (v.action === 'set_follow_up_days') return typeof v.action_value.days === 'number'
  if (v.action === 'add_note') return !!v.action_value.note
  if (v.action === 'start_cadence') return !!v.action_value.cadence_id
  return true
}

export const createAutomationRequest = z
  .object({
    name: z.string().trim().min(2).max(80),
    trigger: automationTrigger,
    condition: automationCondition.default({}),
    action: automationAction,
    action_value: automationActionValue.default({}),
    is_active: z.boolean().default(true),
  })
  .refine(actionNeedsValue, { message: 'This action needs a value.', path: ['action_value'] })
export type CreateAutomationRequest = z.infer<typeof createAutomationRequest>

export const updateAutomationRequest = z.object({
  name: z.string().trim().min(2).max(80).optional(),
  is_active: z.boolean().optional(),
})
export type UpdateAutomationRequest = z.infer<typeof updateAutomationRequest>

// ── saved views (per person, every device) ────────────────────
export const savedViewQuery = z.object({
  search: z.string().max(200).default(''),
  filters: z.array(z.string().max(40)).max(20).default([]),
  status: z.string().max(40).default('all'),
  assignee: z.string().max(60).default('all'),
})
export type SavedViewQuery = z.infer<typeof savedViewQuery>

export const savedView = z.object({
  id: uuid,
  /** Creator — the UI only offers rename/delete on your own. */
  user_id: uuid,
  name: z.string(),
  query: savedViewQuery,
  visibility: z.enum(['private','team','everyone']).default('private'),
  created_at: isoDateTime,
})
export type SavedView = z.infer<typeof savedView>

export const createSavedViewRequest = z.object({
  name: z.string().trim().min(1).max(80),
  query: savedViewQuery,
  visibility: z.enum(['private','team','everyone']).default('private'),
})
export type CreateSavedViewRequest = z.infer<typeof createSavedViewRequest>

export const updateSavedViewRequest = z
  .object({
    name: z.string().trim().min(1).max(80).optional(),
    query: savedViewQuery.optional(),
    visibility: z.enum(['private', 'team', 'everyone']).optional(),
  })
  .refine((v) => Object.keys(v).length > 0, 'Nothing to change.')
export type UpdateSavedViewRequest = z.infer<typeof updateSavedViewRequest>

// ── settings ──────────────────────────────────────────────────
export const crmSettings = z.object({
  /** Hours a new lead may wait before first contact and still count as on time. */
  sla_hours: z.number().int().min(1).max(720),
})
export type CrmSettings = z.infer<typeof crmSettings>

export const updateCrmSettingsRequest = crmSettings.partial()
export type UpdateCrmSettingsRequest = z.infer<typeof updateCrmSettingsRequest>

// ── cadences ──────────────────────────────────────────────────
export const cadenceStep = z.object({
  id: uuid,
  step_no: z.number().int().min(1).max(30),
  /** Days after the cadence starts. 0 = the same day. */
  day_offset: z.number().int().min(0).max(365),
  template_id: uuid.nullable(),
  template_name: z.string().nullable().default(null),
  note: z.string().nullable(),
})
export type CadenceStep = z.infer<typeof cadenceStep>

export const cadence = z.object({
  id: uuid,
  name: z.string(),
  is_active: z.boolean(),
  steps: z.array(cadenceStep),
  /** Leads currently on it. */
  active_leads: z.number().int().default(0),
  created_at: isoDateTime,
})
export type Cadence = z.infer<typeof cadence>

export const cadenceStepInput = z.object({
  day_offset: z.number().int().min(0).max(365),
  template_id: uuid.nullable().optional(),
  note: z.string().trim().max(300).nullable().optional(),
})
export type CadenceStepInput = z.infer<typeof cadenceStepInput>

export const createCadenceRequest = z.object({
  name: z.string().trim().min(2).max(80),
  steps: z
    .array(cadenceStepInput)
    .min(1)
    .max(30)
    .refine((steps) => steps.every((s, i) => i === 0 || s.day_offset >= steps[i - 1]!.day_offset), {
      message: 'Steps must be in day order.',
    }),
})
export type CreateCadenceRequest = z.infer<typeof createCadenceRequest>

export const updateCadenceRequest = z.object({
  name: z.string().trim().min(2).max(80).optional(),
  is_active: z.boolean().optional(),
})
export type UpdateCadenceRequest = z.infer<typeof updateCadenceRequest>

export const startCadenceRequest = z.object({ cadence_id: uuid })
export type StartCadenceRequest = z.infer<typeof startCadenceRequest>

/** Where a lead sits on its cadence, or null when it is on none. */
export const leadCadence = z.object({
  cadence_id: uuid,
  cadence_name: z.string(),
  step_no: z.number().int(),
  total_steps: z.number().int(),
  next_at: isoDateTime.nullable(),
  started_at: isoDateTime,
  completed_at: isoDateTime.nullable(),
  stopped_at: isoDateTime.nullable(),
})
export type LeadCadence = z.infer<typeof leadCadence>

// ── lead → project ────────────────────────────────────────────
export const convertLeadRequest = z
  .object({
    /** An existing client, or none to create one from the lead. */
    client_id: uuid.optional(),
    client: z
      .object({
        name: z.string().trim().min(1).max(160).optional(),
        email: z.string().trim().max(200).optional(),
        phone: z.string().trim().max(30).optional(),
        city: z.string().trim().max(120).optional(),
      })
      .optional(),
    project: z.object({
      name: z.string().trim().min(1).max(200),
      package_cost: z.number().finite().nonnegative().default(0),
      status: z.enum(['active', 'on_hold']).default('active'),
    }),
  })
  .refine((v) => !(v.client_id && v.client), {
    message: 'Pick a client or describe a new one, not both.',
  })
export type ConvertLeadRequest = z.infer<typeof convertLeadRequest>

export const convertLeadResponse = z.object({ client_id: uuid, project_id: uuid })
export type ConvertLeadResponse = z.infer<typeof convertLeadResponse>
