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
  lost_competitor: z.string().nullable().default(null),
  sla_due_at: isoDateTime.nullable().default(null),
  /** The pipeline and stage the deal sits in; status is derived from the stage's kind. */
  pipeline_id: uuid.nullable().default(null),
  stage_id: uuid.nullable().default(null),
  stage_name: z.string().nullable().default(null),
  /** The person and (optionally) the organisation this deal belongs to. */
  contact_id: uuid.nullable().default(null),
  crm_company_id: uuid.nullable().default(null),
  crm_company_name: z.string().nullable().default(null),
  title: z.string().nullable().default(null),
  close_date: isoDate.nullable().default(null),
  currency: z.string().default('INR'),
  score: z.number().int().default(0),
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
  pipeline_id: uuid.optional(),
  stage_id: uuid.optional(),
  contact_id: uuid.optional(),
  crm_company_id: uuid.optional(),
  /** Free text over name, phone, email and title. */
  q: z.string().trim().max(200).optional(),
})
export type LeadsQuery = z.infer<typeof leadsQuery>

export const updateLeadRequest = z.object({
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
  lost_competitor: z.string().trim().max(120).nullable().optional(),
  title: z.string().trim().max(160).nullable().optional(),
  close_date: isoDate.nullable().optional(),
  currency: z.string().regex(/^[A-Z]{3}$/).optional(),
  contact_id: uuid.nullable().optional(),
  crm_company_id: uuid.nullable().optional(),
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
  title: z.string().trim().max(160).optional(),
  close_date: isoDate.optional(),
  pipeline_id: uuid.optional(),
  stage_id: uuid.optional(),
  crm_company_id: uuid.optional(),
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
      stage_id: uuid.optional(),
      lost_reason: z.string().trim().min(3).max(500).optional(),
      lost_competitor: z.string().trim().max(120).optional(),
      assigned_to: uuid.nullable().optional(),
      is_hot: z.boolean().optional(),
      follow_up_at: isoDateTime.nullable().optional(),
      is_archived: z.boolean().optional(),
      deal_value: z.number().min(0).max(1_00_00_000).nullable().optional(),
      probability: z.number().int().min(0).max(100).nullable().optional(),
      close_date: isoDate.nullable().optional(),
    })
    .refine((p) => Object.keys(p).length > 0, 'Nothing to change.'),
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
  deal_value: z.coerce.number().nullable().default(null),
  probability: z.number().int().nullable().default(null),
  lost_reason: z.string().nullable().default(null),
  lost_competitor: z.string().nullable().default(null),
  stage_id: uuid.nullable().default(null),
  close_date: isoDate.nullable().default(null),
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

export const updateAutomationRequest = z
  .object({
    name: z.string().trim().min(2).max(80).optional(),
    trigger: automationTrigger.optional(),
    condition: automationCondition.optional(),
    action: automationAction.optional(),
    action_value: automationActionValue.optional(),
    is_active: z.boolean().optional(),
  })
  .refine((v) => !v.action || actionNeedsValue({ action: v.action, action_value: v.action_value ?? {} }), {
    message: 'This action needs a value.',
    path: ['action_value'],
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

export const savedViewVisibility = z.enum(['private', 'team', 'everyone'])
export type SavedViewVisibility = z.infer<typeof savedViewVisibility>

export const savedView = z.object({
  id: uuid,
  name: z.string(),
  query: savedViewQuery,
  /** private = mine only; team / everyone = shared with the studio. */
  visibility: savedViewVisibility.default('private'),
  user_id: uuid,
  owner_name: z.string().nullable().default(null),
  created_at: isoDateTime,
})
export type SavedView = z.infer<typeof savedView>

export const createSavedViewRequest = z.object({
  name: z.string().trim().min(1).max(80),
  query: savedViewQuery,
  visibility: savedViewVisibility.default('private'),
})
export type CreateSavedViewRequest = z.infer<typeof createSavedViewRequest>

export const updateSavedViewRequest = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  query: savedViewQuery.optional(),
  visibility: savedViewVisibility.optional(),
})
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

// ── ad-hoc responses, named ───────────────────────────────────
export const idResponse = z.object({ id: uuid })
export type IdResponse = z.infer<typeof idResponse>

export const cadenceStartResponse = z.object({ next_at: isoDateTime.nullable() })
export type CadenceStartResponse = z.infer<typeof cadenceStartResponse>

// ── pipelines and stages ──────────────────────────────────────
export const stageKind = z.enum(['open', 'won', 'lost'])
export type StageKind = z.infer<typeof stageKind>

/** The fields a stage can insist on before a deal enters it. */
export const stageRequiredField = z.enum(['deal_value', 'close_date', 'email', 'name', 'assigned_to', 'title', 'lost_reason'])
export type StageRequiredField = z.infer<typeof stageRequiredField>

export const pipelineStage = z.object({
  id: uuid,
  pipeline_id: uuid,
  name: z.string(),
  key: z.string(),
  position: z.number().int(),
  kind: stageKind,
  probability_default: z.number().int().min(0).max(100),
  wip_limit: z.number().int().nullable(),
  required_fields: z.array(stageRequiredField),
  /** Open, unarchived deals in the stage right now. */
  deal_count: z.number().int().default(0),
})
export type PipelineStage = z.infer<typeof pipelineStage>

export const pipeline = z.object({
  id: uuid,
  name: z.string(),
  is_default: z.boolean(),
  position: z.number().int(),
  stages: z.array(pipelineStage),
  created_at: isoDateTime,
})
export type Pipeline = z.infer<typeof pipeline>

const stageKey = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z][a-z0-9_]{0,39}$/, 'Keys are lowercase letters, digits and underscores.')

export const createPipelineRequest = z.object({
  name: z.string().trim().min(2).max(80),
  is_default: z.boolean().default(false),
})
export type CreatePipelineRequest = z.infer<typeof createPipelineRequest>

export const updatePipelineRequest = z.object({
  name: z.string().trim().min(2).max(80).optional(),
  is_default: z.literal(true).optional(),
  position: z.number().int().min(0).max(1000).optional(),
})
export type UpdatePipelineRequest = z.infer<typeof updatePipelineRequest>

export const createStageRequest = z.object({
  name: z.string().trim().min(1).max(60),
  key: stageKey.optional(),
  kind: stageKind.default('open'),
  position: z.number().int().min(0).max(1000).optional(),
  probability_default: z.number().int().min(0).max(100).optional(),
  wip_limit: z.number().int().min(1).max(1000).nullable().optional(),
  required_fields: z.array(stageRequiredField).max(7).default([]),
})
export type CreateStageRequest = z.infer<typeof createStageRequest>

export const updateStageRequest = z.object({
  name: z.string().trim().min(1).max(60).optional(),
  kind: stageKind.optional(),
  position: z.number().int().min(0).max(1000).optional(),
  probability_default: z.number().int().min(0).max(100).optional(),
  wip_limit: z.number().int().min(1).max(1000).nullable().optional(),
  required_fields: z.array(stageRequiredField).max(7).optional(),
})
export type UpdateStageRequest = z.infer<typeof updateStageRequest>

export const reorderStagesRequest = z.object({ stage_ids: z.array(uuid).min(1).max(50) })
export type ReorderStagesRequest = z.infer<typeof reorderStagesRequest>

/** POST /crm/leads/:id/stage — the one way a deal moves between stages. */
export const moveStageRequest = z.object({
  stage_id: uuid,
  lost_reason: z.string().trim().min(3).max(500).optional(),
  lost_competitor: z.string().trim().max(120).optional(),
})
export type MoveStageRequest = z.infer<typeof moveStageRequest>

export const moveStageResponse = z.object({ status: leadStatus, stage_id: uuid })
export type MoveStageResponse = z.infer<typeof moveStageResponse>

// ── lost reasons ──────────────────────────────────────────────
export const lostReason = z.object({
  id: uuid,
  label: z.string(),
  position: z.number().int(),
  is_active: z.boolean(),
})
export type LostReason = z.infer<typeof lostReason>

export const createLostReasonRequest = z.object({ label: z.string().trim().min(3).max(80) })
export type CreateLostReasonRequest = z.infer<typeof createLostReasonRequest>

export const updateLostReasonRequest = z.object({
  label: z.string().trim().min(3).max(80).optional(),
  position: z.number().int().min(0).max(1000).optional(),
  is_active: z.boolean().optional(),
})
export type UpdateLostReasonRequest = z.infer<typeof updateLostReasonRequest>

// ── contacts and companies ────────────────────────────────────
export const contactLifecycle = z.enum(['lead', 'mql', 'sql', 'customer', 'other'])
export type ContactLifecycle = z.infer<typeof contactLifecycle>

export const crmContact = z.object({
  id: uuid,
  name: z.string().nullable(),
  phone: z.string().nullable(),
  email: z.string().nullable(),
  lifecycle: contactLifecycle,
  owner_id: uuid.nullable(),
  owner_name: z.string().nullable().default(null),
  source: z.string().nullable(),
  crm_company_id: uuid.nullable(),
  crm_company_name: z.string().nullable().default(null),
  notes: z.string().nullable(),
  is_archived: z.boolean(),
  /** Deals on this contact: all, and the ones still open. */
  deal_count: z.number().int().default(0),
  open_deal_count: z.number().int().default(0),
  last_contacted_at: isoDateTime.nullable().default(null),
  created_at: isoDateTime,
})
export type CrmContact = z.infer<typeof crmContact>

export const contactsQuery = z.object({
  q: z.string().trim().max(200).optional(),
  include_archived: z
    .union([z.literal('1'), z.literal('0'), z.literal('true'), z.literal('false')])
    .optional()
    .transform((v) => v === '1' || v === 'true'),
  crm_company_id: uuid.optional(),
  limit: z.coerce.number().int().min(1).max(5000).default(1000),
})
export type ContactsQuery = z.infer<typeof contactsQuery>

export const createContactRequest = z.object({
  name: z.string().trim().min(1).max(160),
  phone: z.string().trim().min(6).max(30).optional(),
  email: z.string().trim().max(200).optional(),
  lifecycle: contactLifecycle.default('lead'),
  owner_id: uuid.nullable().optional(),
  crm_company_id: uuid.nullable().optional(),
  notes: z.string().max(4000).optional(),
})
export type CreateContactRequest = z.infer<typeof createContactRequest>

export const updateContactRequest = z.object({
  name: z.string().trim().max(160).nullable().optional(),
  phone: z.string().trim().max(30).nullable().optional(),
  email: z.string().trim().max(200).nullable().optional(),
  lifecycle: contactLifecycle.optional(),
  owner_id: uuid.nullable().optional(),
  crm_company_id: uuid.nullable().optional(),
  notes: z.string().max(4000).nullable().optional(),
  is_archived: z.boolean().optional(),
})
export type UpdateContactRequest = z.infer<typeof updateContactRequest>

export const crmCompany = z.object({
  id: uuid,
  name: z.string(),
  domain: z.string().nullable(),
  phone: z.string().nullable(),
  city: z.string().nullable(),
  notes: z.string().nullable(),
  owner_id: uuid.nullable(),
  owner_name: z.string().nullable().default(null),
  is_archived: z.boolean(),
  contact_count: z.number().int().default(0),
  deal_count: z.number().int().default(0),
  open_value: z.coerce.number().default(0),
  created_at: isoDateTime,
})
export type CrmCompany = z.infer<typeof crmCompany>

export const createCrmCompanyRequest = z.object({
  name: z.string().trim().min(1).max(160),
  domain: z.string().trim().max(200).optional(),
  phone: z.string().trim().max(30).optional(),
  city: z.string().trim().max(120).optional(),
  notes: z.string().max(4000).optional(),
  owner_id: uuid.nullable().optional(),
})
export type CreateCrmCompanyRequest = z.infer<typeof createCrmCompanyRequest>

export const updateCrmCompanyRequest = z.object({
  name: z.string().trim().min(1).max(160).optional(),
  domain: z.string().trim().max(200).nullable().optional(),
  phone: z.string().trim().max(30).nullable().optional(),
  city: z.string().trim().max(120).nullable().optional(),
  notes: z.string().max(4000).nullable().optional(),
  owner_id: uuid.nullable().optional(),
  is_archived: z.boolean().optional(),
})
export type UpdateCrmCompanyRequest = z.infer<typeof updateCrmCompanyRequest>

// ── forecast ──────────────────────────────────────────────────
const forecastBucket = z.object({
  count: z.number().int(),
  total_value: z.coerce.number(),
  weighted: z.coerce.number(),
})

export const crmForecast = z.object({
  from: isoDate,
  to: isoDate,
  count: z.number().int(),
  total_value: z.coerce.number(),
  /** Σ deal_value × probability over open deals, plus won deals at 100%. */
  weighted: z.coerce.number(),
  won_value: z.coerce.number(),
  open_value: z.coerce.number(),
  by_stage: z.array(forecastBucket.extend({ stage_id: uuid.nullable(), name: z.string(), kind: stageKind })),
  by_owner: z.array(forecastBucket.extend({ user_id: uuid.nullable(), name: z.string() })),
  by_month: z.array(forecastBucket.extend({ month: z.string().regex(/^\d{4}-\d{2}$/) })),
})
export type CrmForecast = z.infer<typeof crmForecast>
