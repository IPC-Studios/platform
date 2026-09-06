import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import {
  bulkPatchResponse,
  bulkUndoResponse,
  cadence,
  cadenceStartResponse,
  convertLeadRequest,
  convertLeadResponse,
  createCadenceRequest,
  createLeadRequest,
  crmActivity,
  crmCompany,
  crmContact,
  crmForecast,
  crmIntegration,
  emailSyncResponse,
  placeCallResponse,
  scheduleMeetingResponse,
  timelineResponse,
  crmLead,
  crmSettings,
  createWorkflowRequest,
  enrollWorkflowResponse,
  recomputeScoresResponse,
  scoringRule,
  workflow,
  workflowEnrollment,
  crmStats,
  crmTeamStatsRow,
  crmTemplate,
  csvImportCommitResponse,
  csvImportPreviewResponse,
  distributionRule,
  duplicateGroup,
  idResponse,
  leadCadence,
  leadEvent,
  lostReason,
  mergeLeadsResponse,
  moveStageResponse,
  pipeline,
  savedView,
  sendTemplateResponse,
  unmergeLeadsResponse,
  updateLeadRequest,
  z,
  type BulkLeadPatch,
  type BulkUndoRequest,
  type ConvertLeadRequest,
  type CreateActivityRequest,
  type CreateCadenceRequest,
  type CreateContactRequest,
  type CreateCrmCompanyRequest,
  type CreateDistributionRequest,
  type CreateLeadRequest,
  type CreateLostReasonRequest,
  type CreatePipelineRequest,
  type CreateSavedViewRequest,
  type CreateScoringRuleRequest,
  type CreateStageRequest,
  type CreateWorkflowRequest,
  type CreateTemplateRequest,
  type CrmStatsQuery,
  type CsvImportCommitRequest,
  type MergeLeadsRequest,
  type MoveStageRequest,
  type PlaceCallRequest,
  type ScheduleMeetingRequest,
  type SendTemplateRequest,
  type UpdateActivityRequest,
  type UpdateCadenceRequest,
  type UpdateContactRequest,
  type UpdateCrmCompanyRequest,
  type UpdateCrmSettingsRequest,
  type UpdateDistributionRequest,
  type UpdateIntegrationRequest,
  type UpdateLeadRequest,
  type UpdateLostReasonRequest,
  type UpdatePipelineRequest,
  type UpdateSavedViewRequest,
  type UpdateScoringRuleRequest,
  type UpdateStageRequest,
  type UpdateWorkflowRequest,
} from '@ipc/contracts'
import { callApi } from '@/shared/api/client'
import { useAuth } from '@/shared/auth/AuthProvider'
import { useAccess } from '@/shared/auth/useAccess'

const leadsList = crmLead.array()
const rulesList = distributionRule.array()
const noContent = z.any()

/** Every CRM read hangs off ['crm', …] so one invalidation refreshes the page. */
function useCrmQuery<T>(key: readonly unknown[], fn: () => Promise<T>, staleTime = 15_000) {
  const { session } = useAuth()
  const access = useAccess()
  return useQuery({
    queryKey: ['crm', ...key],
    queryFn: fn,
    enabled: !!session && access.hasModule('crm'),
    staleTime,
  })
}

export function useLeads(includeArchived = false) {
  return useCrmQuery(['leads', includeArchived ? 'all' : 'active'], () =>
    callApi(`/crm/leads${includeArchived ? '?include_archived=1' : ''}`, { responseSchema: leadsList }),
  )
}

export function useDistribution() {
  return useCrmQuery(['distribution'], () => callApi('/crm/distribution', { responseSchema: rulesList }), 60_000)
}

export function useDuplicateGroups() {
  return useCrmQuery(['duplicates'], () => callApi('/crm/duplicates', { responseSchema: duplicateGroup.array() }), 30_000)
}

export function useTemplates() {
  return useCrmQuery(['templates'], () => callApi('/crm/templates', { responseSchema: crmTemplate.array() }), 60_000)
}

export function useCrmStats(range: CrmStatsQuery) {
  return useCrmQuery(['stats', range.from, range.to], () =>
    callApi(`/crm/stats?from=${range.from}&to=${range.to}`, { responseSchema: crmStats }),
  )
}

export function useTeamStats(range: CrmStatsQuery) {
  return useCrmQuery(['team-stats', range.from, range.to], () =>
    callApi(`/crm/team-stats?from=${range.from}&to=${range.to}`, { responseSchema: crmTeamStatsRow.array() }),
  )
}

export function useLeadEvents(id: string) {
  const { session } = useAuth()
  return useQuery({
    queryKey: ['crm', 'events', id],
    queryFn: () => callApi(`/crm/leads/${id}/events`, { responseSchema: leadEvent.array() }),
    enabled: !!session && !!id,
  })
}

function useCrmMutation<TInput, TOutput>(
  fn: (input: TInput) => Promise<TOutput>,
  success?: string | ((out: TOutput) => string),
) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: fn,
    onSuccess: (out) => {
      if (success) toast.success(typeof success === 'function' ? success(out) : success)
      void qc.invalidateQueries({ queryKey: ['crm'] })
    },
    onError: (e: Error) => toast.error(e.message),
  })
}

export function useAddLead() {
  return useCrmMutation(
    (input: CreateLeadRequest) =>
      callApi('/crm/leads', {
        method: 'POST',
        body: createLeadRequest.parse(input),
        responseSchema: crmLead,
      }),
    'Lead added',
  )
}

/**
 * One mutation for every field on a lead. Stage moves, the hot flag and the
 * next follow-up all go through the same PATCH, so the server stays the only
 * place that decides what a stage change timestamps.
 */
export function useUpdateLead(success?: string) {
  return useCrmMutation(
    ({ id, patch }: { id: string; patch: UpdateLeadRequest }) =>
      callApi(`/crm/leads/${id}`, {
        method: 'PATCH',
        body: updateLeadRequest.parse(patch),
        responseSchema: noContent,
      }),
    success,
  )
}

/**
 * Bulk edit. The response carries what every lead looked like before, and the
 * success toast offers to put it back — the undo the desk kept asking for.
 */
export function useBulkPatch() {
  const qc = useQueryClient()
  const undo = useMutation({
    mutationFn: (input: BulkUndoRequest) =>
      callApi('/crm/leads/bulk/undo', { method: 'POST', body: input, responseSchema: bulkUndoResponse }),
    onSuccess: (r) => {
      toast.success(`Restored ${r.restored} lead${r.restored === 1 ? '' : 's'}`)
      void qc.invalidateQueries({ queryKey: ['crm'] })
    },
    onError: (e: Error) => toast.error(e.message),
  })
  return useMutation({
    mutationFn: (input: BulkLeadPatch) =>
      callApi('/crm/leads/bulk', { method: 'POST', body: input, responseSchema: bulkPatchResponse }),
    onSuccess: (r) => {
      toast.success(`Updated ${r.updated} lead${r.updated === 1 ? '' : 's'}`, {
        action: r.previous.length
          ? { label: 'Undo', onClick: () => undo.mutate({ previous: r.previous }) }
          : undefined,
        duration: 8000,
      })
      void qc.invalidateQueries({ queryKey: ['crm'] })
    },
    onError: (e: Error) => toast.error(e.message),
  })
}

export function useMerge() {
  return useCrmMutation(
    (input: MergeLeadsRequest) =>
      callApi('/crm/leads/merge', { method: 'POST', body: input, responseSchema: mergeLeadsResponse }),
    (r) => `Merged ${r.merged} duplicate${r.merged === 1 ? '' : 's'}`,
  )
}

export function useUnmerge() {
  return useCrmMutation(
    (survivorId: string) =>
      callApi('/crm/leads/unmerge', {
        method: 'POST',
        body: { survivor_id: survivorId },
        responseSchema: unmergeLeadsResponse,
      }),
    (r) => `Restored ${r.restored} lead${r.restored === 1 ? '' : 's'}`,
  )
}

export function useCreateTemplate() {
  return useCrmMutation(
    (input: CreateTemplateRequest) =>
      callApi('/crm/templates', { method: 'POST', body: input, responseSchema: crmTemplate }),
    'Template saved',
  )
}

export function useDeleteTemplate() {
  return useCrmMutation(
    (id: string) => callApi(`/crm/templates/${id}`, { method: 'DELETE', responseSchema: noContent }),
    'Template deleted',
  )
}

/** Renders a template for a lead, records the contact, returns the link to open. */
export function useSendTemplate() {
  return useCrmMutation(({ leadId, ...body }: SendTemplateRequest & { leadId: string }) =>
    callApi(`/crm/leads/${leadId}/send-template`, {
      method: 'POST',
      body,
      responseSchema: sendTemplateResponse,
    }),
  )
}

export function useImportPreview() {
  return useMutation({
    mutationFn: (csv: string) =>
      callApi('/crm/imports/preview', { method: 'POST', body: { csv }, responseSchema: csvImportPreviewResponse }),
    onError: (e: Error) => toast.error(e.message),
  })
}

export function useImportCommit() {
  return useCrmMutation(
    (input: CsvImportCommitRequest) =>
      callApi('/crm/imports/commit', { method: 'POST', body: input, responseSchema: csvImportCommitResponse }),
    (r) => `Imported ${r.created}${r.skipped ? `, skipped ${r.skipped} known` : ''}`,
  )
}

export function useAddToRota() {
  return useCrmMutation(
    (input: CreateDistributionRequest) =>
      callApi('/crm/distribution', { method: 'POST', body: input, responseSchema: idResponse }),
    'Added to the rota',
  )
}

export function useUpdateDistribution() {
  return useCrmMutation(
    ({ id, patch }: { id: string; patch: UpdateDistributionRequest }) =>
      callApi(`/crm/distribution/${id}`, { method: 'PATCH', body: patch, responseSchema: noContent }),
    'Rota updated',
  )
}

export function useRemoveFromRota() {
  return useCrmMutation(
    (id: string) => callApi(`/crm/distribution/${id}`, { method: 'DELETE', responseSchema: noContent }),
    'Removed from the rota',
  )
}

// ── saved views ───────────────────────────────────────────────
export function useSavedViews() {
  return useCrmQuery(['views'], () => callApi('/crm/views', { responseSchema: savedView.array() }), 60_000)
}

export function useSaveView() {
  return useCrmMutation(
    (input: CreateSavedViewRequest) =>
      callApi('/crm/views', { method: 'POST', body: input, responseSchema: savedView }),
    'View saved',
  )
}

export function useUpdateView() {
  return useCrmMutation(
    ({ id, patch }: { id: string; patch: UpdateSavedViewRequest }) =>
      callApi(`/crm/views/${id}`, { method: 'PATCH', body: patch, responseSchema: noContent }),
    'View updated',
  )
}

export function useDeleteView() {
  return useCrmMutation((id: string) => callApi(`/crm/views/${id}`, { method: 'DELETE', responseSchema: noContent }))
}

// ── settings ──────────────────────────────────────────────────
export function useCrmSettings() {
  return useCrmQuery(['settings'], () => callApi('/crm/settings', { responseSchema: crmSettings }), 60_000)
}

export function useUpdateCrmSettings() {
  return useCrmMutation(
    (input: UpdateCrmSettingsRequest) =>
      callApi('/crm/settings', { method: 'PATCH', body: input, responseSchema: crmSettings }),
    'CRM settings saved',
  )
}

// ── cadences ──────────────────────────────────────────────────
export function useCadences() {
  return useCrmQuery(['cadences'], () => callApi('/crm/cadences', { responseSchema: cadence.array() }), 60_000)
}

export function useCreateCadence() {
  return useCrmMutation(
    (input: CreateCadenceRequest) =>
      callApi('/crm/cadences', {
        method: 'POST',
        body: createCadenceRequest.parse(input),
        responseSchema: idResponse,
      }),
    'Cadence saved',
  )
}

export function useUpdateCadence() {
  return useCrmMutation(({ id, patch }: { id: string; patch: UpdateCadenceRequest }) =>
    callApi(`/crm/cadences/${id}`, { method: 'PATCH', body: patch, responseSchema: noContent }),
  )
}

export function useDeleteCadence() {
  return useCrmMutation(
    (id: string) => callApi(`/crm/cadences/${id}`, { method: 'DELETE', responseSchema: noContent }),
    'Cadence deleted',
  )
}

export function useLeadCadence(leadId: string) {
  const { session } = useAuth()
  return useQuery({
    queryKey: ['crm', 'lead-cadence', leadId],
    queryFn: () => callApi(`/crm/leads/${leadId}/cadence`, { responseSchema: leadCadence.nullable() }),
    enabled: !!session && !!leadId,
  })
}

export function useStartCadence() {
  return useCrmMutation(
    ({ leadId, cadence_id }: { leadId: string; cadence_id: string }) =>
      callApi(`/crm/leads/${leadId}/cadence`, {
        method: 'POST',
        body: { cadence_id },
        responseSchema: cadenceStartResponse,
      }),
    'Cadence started',
  )
}

export function useStopCadence() {
  return useCrmMutation(
    (leadId: string) => callApi(`/crm/leads/${leadId}/cadence`, { method: 'DELETE', responseSchema: noContent }),
    'Cadence stopped',
  )
}

// ── lead → project ────────────────────────────────────────────
export function useConvertLead() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ leadId, ...body }: ConvertLeadRequest & { leadId: string }) =>
      callApi(`/crm/leads/${leadId}/convert`, {
        method: 'POST',
        body: convertLeadRequest.parse(body),
        responseSchema: convertLeadResponse,
      }),
    onSuccess: () => {
      toast.success('Project created')
      void qc.invalidateQueries({ queryKey: ['crm'] })
      void qc.invalidateQueries({ queryKey: ['projects'] })
      void qc.invalidateQueries({ queryKey: ['clients'] })
    },
    onError: (e: Error) => toast.error(e.message),
  })
}

// ── pipelines & stages ────────────────────────────────────────
export function usePipelines() {
  return useCrmQuery(['pipelines'], () => callApi('/crm/pipelines', { responseSchema: pipeline.array() }), 60_000)
}

export function useCreatePipeline() {
  return useCrmMutation(
    (input: CreatePipelineRequest) => callApi('/crm/pipelines', { method: 'POST', body: input, responseSchema: pipeline }),
    'Pipeline created',
  )
}

export function useUpdatePipeline() {
  return useCrmMutation(
    ({ id, patch }: { id: string; patch: UpdatePipelineRequest }) =>
      callApi(`/crm/pipelines/${id}`, { method: 'PATCH', body: patch, responseSchema: noContent }),
    'Pipeline updated',
  )
}

export function useDeletePipeline() {
  return useCrmMutation(
    (id: string) => callApi(`/crm/pipelines/${id}`, { method: 'DELETE', responseSchema: noContent }),
    'Pipeline deleted',
  )
}

export function useCreateStage() {
  return useCrmMutation(
    ({ pipelineId, ...body }: CreateStageRequest & { pipelineId: string }) =>
      callApi(`/crm/pipelines/${pipelineId}/stages`, { method: 'POST', body, responseSchema: pipeline }),
    'Stage added',
  )
}

export function useUpdateStage() {
  return useCrmMutation(
    ({ id, patch }: { id: string; patch: UpdateStageRequest }) =>
      callApi(`/crm/stages/${id}`, { method: 'PATCH', body: patch, responseSchema: noContent }),
    'Stage updated',
  )
}

export function useReorderStages() {
  return useCrmMutation(({ pipelineId, stage_ids }: { pipelineId: string; stage_ids: string[] }) =>
    callApi(`/crm/pipelines/${pipelineId}/stages/reorder`, { method: 'POST', body: { stage_ids }, responseSchema: noContent }),
  )
}

export function useDeleteStage() {
  return useCrmMutation(
    (id: string) => callApi(`/crm/stages/${id}`, { method: 'DELETE', responseSchema: noContent }),
    'Stage removed',
  )
}

/**
 * The one way a deal moves between stages. The server enforces the stage's
 * WIP limit and required fields, and a lost stage needs a reason; its 422
 * message is written for the person and is shown as-is.
 */
export function useMoveStage() {
  return useCrmMutation(({ leadId, ...body }: MoveStageRequest & { leadId: string }) =>
    callApi(`/crm/leads/${leadId}/stage`, { method: 'POST', body, responseSchema: moveStageResponse }),
  )
}

// ── lost reasons ──────────────────────────────────────────────
export function useLostReasons() {
  return useCrmQuery(['lost-reasons'], () => callApi('/crm/lost-reasons', { responseSchema: lostReason.array() }), 300_000)
}

export function useCreateLostReason() {
  return useCrmMutation(
    (input: CreateLostReasonRequest) => callApi('/crm/lost-reasons', { method: 'POST', body: input, responseSchema: lostReason }),
    'Reason added',
  )
}

export function useUpdateLostReason() {
  return useCrmMutation(({ id, patch }: { id: string; patch: UpdateLostReasonRequest }) =>
    callApi(`/crm/lost-reasons/${id}`, { method: 'PATCH', body: patch, responseSchema: noContent }),
  )
}

export function useDeleteLostReason() {
  return useCrmMutation(
    (id: string) => callApi(`/crm/lost-reasons/${id}`, { method: 'DELETE', responseSchema: noContent }),
    'Reason removed',
  )
}

// ── contacts & companies ──────────────────────────────────────
export function useContacts(opts: { q?: string; includeArchived?: boolean; companyId?: string } = {}) {
  const params = new URLSearchParams()
  if (opts.q) params.set('q', opts.q)
  if (opts.includeArchived) params.set('include_archived', '1')
  if (opts.companyId) params.set('crm_company_id', opts.companyId)
  const qs = params.toString()
  return useCrmQuery(['contacts', qs], () => callApi(`/crm/contacts${qs ? `?${qs}` : ''}`, { responseSchema: crmContact.array() }), 30_000)
}

export function useContact(id: string | null) {
  const { session } = useAuth()
  return useQuery({
    queryKey: ['crm', 'contact', id],
    queryFn: () => callApi(`/crm/contacts/${id}`, { responseSchema: crmContact }),
    enabled: !!session && !!id,
  })
}

export function useCreateContact() {
  return useCrmMutation(
    (input: CreateContactRequest) => callApi('/crm/contacts', { method: 'POST', body: input, responseSchema: crmContact }),
    'Contact added',
  )
}

export function useUpdateContact() {
  return useCrmMutation(
    ({ id, patch }: { id: string; patch: UpdateContactRequest }) =>
      callApi(`/crm/contacts/${id}`, { method: 'PATCH', body: patch, responseSchema: noContent }),
    'Contact updated',
  )
}

export function useCrmCompanies(includeArchived = false) {
  return useCrmQuery(
    ['companies', includeArchived ? 'all' : 'active'],
    () => callApi(`/crm/companies${includeArchived ? '?include_archived=1' : ''}`, { responseSchema: crmCompany.array() }),
    30_000,
  )
}

export function useCreateCrmCompany() {
  return useCrmMutation(
    (input: CreateCrmCompanyRequest) => callApi('/crm/companies', { method: 'POST', body: input, responseSchema: crmCompany }),
    'Company added',
  )
}

export function useUpdateCrmCompany() {
  return useCrmMutation(
    ({ id, patch }: { id: string; patch: UpdateCrmCompanyRequest }) =>
      callApi(`/crm/companies/${id}`, { method: 'PATCH', body: patch, responseSchema: noContent }),
    'Company updated',
  )
}

/** Deals on one contact or company, archived included so history is complete. */
export function useDealsFor(filter: { contactId?: string; companyId?: string }) {
  const params = new URLSearchParams({ include_archived: '1' })
  if (filter.contactId) params.set('contact_id', filter.contactId)
  if (filter.companyId) params.set('crm_company_id', filter.companyId)
  const qs = params.toString()
  return useCrmQuery(['leads', 'for', qs], () => callApi(`/crm/leads?${qs}`, { responseSchema: leadsList }), 15_000)
}

// ── forecast ──────────────────────────────────────────────────
export function useForecast(range: CrmStatsQuery) {
  return useCrmQuery(['forecast', range.from, range.to], () =>
    callApi(`/crm/forecast?from=${range.from}&to=${range.to}`, { responseSchema: crmForecast }),
  )
}

// ── activities ────────────────────────────────────────────────
export function useActivities(opts: { leadId?: string; contactId?: string; type?: string; assignedTo?: string; openTasks?: boolean } = {}) {
  const params = new URLSearchParams()
  if (opts.leadId) params.set('lead_id', opts.leadId)
  if (opts.contactId) params.set('contact_id', opts.contactId)
  if (opts.type) params.set('type', opts.type)
  if (opts.assignedTo) params.set('assigned_to', opts.assignedTo)
  if (opts.openTasks) params.set('open_tasks', '1')
  const qs = params.toString()
  return useCrmQuery(['activities', qs], () => callApi(`/crm/activities${qs ? `?${qs}` : ''}`, { responseSchema: crmActivity.array() }))
}

/** The deal's stage trail and activities, newest first, a page at a time. */
export function useTimeline(leadId: string) {
  const { session } = useAuth()
  return useInfiniteQuery({
    queryKey: ['crm', 'timeline', leadId],
    queryFn: ({ pageParam }) =>
      callApi(`/crm/leads/${leadId}/timeline?limit=40${pageParam ? `&before=${encodeURIComponent(pageParam)}` : ''}`, {
        responseSchema: timelineResponse,
      }),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.next_cursor,
    enabled: !!session && !!leadId,
  })
}

export function useLogActivity() {
  return useCrmMutation(
    (input: CreateActivityRequest) => callApi('/crm/activities', { method: 'POST', body: input, responseSchema: crmActivity }),
    (a) => (a.type === 'task' ? 'Task added' : 'Logged'),
  )
}

export function useUpdateActivity() {
  return useCrmMutation(({ id, patch }: { id: string; patch: UpdateActivityRequest }) =>
    callApi(`/crm/activities/${id}`, { method: 'PATCH', body: patch, responseSchema: noContent }),
  )
}

export function useDeleteActivity() {
  return useCrmMutation((id: string) => callApi(`/crm/activities/${id}`, { method: 'DELETE', responseSchema: noContent }), 'Removed')
}

/** Rings the agent then the lead when Twilio is connected; otherwise logs a manual call and hands back tel:. */
export function usePlaceCall() {
  return useCrmMutation((input: PlaceCallRequest) =>
    callApi('/crm/activities/call', { method: 'POST', body: input, responseSchema: placeCallResponse }),
  )
}

export function useScheduleMeeting() {
  return useCrmMutation(
    (input: ScheduleMeetingRequest) =>
      callApi('/crm/activities/meeting', { method: 'POST', body: input, responseSchema: scheduleMeetingResponse }),
    'Meeting scheduled',
  )
}

export function useEmailSync() {
  return useCrmMutation(
    (sinceDays: number) =>
      callApi('/crm/activities/email/sync', { method: 'POST', body: { since_days: sinceDays }, responseSchema: emailSyncResponse }),
    (r) =>
      r.status === 'ok'
        ? `Synced ${r.imported} new message${r.imported === 1 ? '' : 's'}${r.unmatched ? ` · ${r.unmatched} unmatched` : ''}`
        : (r.message ?? 'Mailbox sync is not configured.'),
  )
}

export function useIntegrations() {
  return useCrmQuery(['integrations'], () => callApi('/crm/integrations', { responseSchema: crmIntegration.array() }), 60_000)
}

export function useUpdateIntegration() {
  return useCrmMutation(
    ({ provider, patch }: { provider: string; patch: UpdateIntegrationRequest }) =>
      callApi(`/crm/integrations/${provider}`, { method: 'PUT', body: patch, responseSchema: noContent }),
    'Integration updated',
  )
}

// ── workflows ─────────────────────────────────────────────────
export function useWorkflows() {
  return useCrmQuery(['workflows'], () => callApi('/crm/workflows', { responseSchema: workflow.array() }), 60_000)
}

export function useCreateWorkflow() {
  return useCrmMutation(
    (input: CreateWorkflowRequest) =>
      callApi('/crm/workflows', { method: 'POST', body: createWorkflowRequest.parse(input), responseSchema: workflow }),
    'Workflow saved',
  )
}

export function useUpdateWorkflow() {
  return useCrmMutation(
    ({ id, patch }: { id: string; patch: UpdateWorkflowRequest }) =>
      callApi(`/crm/workflows/${id}`, { method: 'PATCH', body: patch, responseSchema: noContent }),
    'Workflow updated',
  )
}

export function useDeleteWorkflow() {
  return useCrmMutation(
    (id: string) => callApi(`/crm/workflows/${id}`, { method: 'DELETE', responseSchema: noContent }),
    'Workflow deleted',
  )
}

export function useWorkflowEnrollments(workflowId: string) {
  return useCrmQuery(['workflow-enrollments', workflowId], () =>
    callApi(`/crm/workflows/${workflowId}/enrollments`, { responseSchema: workflowEnrollment.array() }),
  )
}

export function useLeadEnrollments(leadId: string) {
  return useCrmQuery(['lead-enrollments', leadId], () =>
    callApi(`/crm/leads/${leadId}/enrollments`, { responseSchema: workflowEnrollment.array() }),
  )
}

export function useEnrollWorkflow() {
  return useCrmMutation(
    ({ workflowId, lead_ids }: { workflowId: string; lead_ids: string[] }) =>
      callApi(`/crm/workflows/${workflowId}/enroll`, { method: 'POST', body: { lead_ids }, responseSchema: enrollWorkflowResponse }),
    (r) => (r.enrolled === 0 ? 'Already enrolled' : `Enrolled ${r.enrolled} deal${r.enrolled === 1 ? '' : 's'}`),
  )
}

export function useExitEnrollment() {
  return useCrmMutation(
    (id: string) => callApi(`/crm/enrollments/${id}/exit`, { method: 'POST', body: {}, responseSchema: noContent }),
    'Stopped',
  )
}

// ── scoring ───────────────────────────────────────────────────
export function useScoringRules() {
  return useCrmQuery(['scoring-rules'], () => callApi('/crm/scoring-rules', { responseSchema: scoringRule.array() }), 60_000)
}

export function useCreateScoringRule() {
  return useCrmMutation(
    (input: CreateScoringRuleRequest) => callApi('/crm/scoring-rules', { method: 'POST', body: input, responseSchema: scoringRule }),
    'Rule added',
  )
}

export function useUpdateScoringRule() {
  return useCrmMutation(({ id, patch }: { id: string; patch: UpdateScoringRuleRequest }) =>
    callApi(`/crm/scoring-rules/${id}`, { method: 'PATCH', body: patch, responseSchema: noContent }),
  )
}

export function useDeleteScoringRule() {
  return useCrmMutation(
    (id: string) => callApi(`/crm/scoring-rules/${id}`, { method: 'DELETE', responseSchema: noContent }),
    'Rule removed',
  )
}

export function useRecomputeScores() {
  return useCrmMutation(
    (_: void) => callApi('/crm/scoring/recompute', { method: 'POST', body: {}, responseSchema: recomputeScoresResponse }),
    (r) => `Rescored ${r.rescored} deal${r.rescored === 1 ? '' : 's'}`,
  )
}
