import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import {
  automationRule,
  bulkPatchResponse,
  bulkUndoResponse,
  cadence,
  convertLeadRequest,
  convertLeadResponse,
  createAutomationRequest,
  createCadenceRequest,
  createLeadRequest,
  crmLead,
  crmSettings,
  crmStats,
  crmTeamStatsRow,
  crmTemplate,
  csvImportCommitResponse,
  csvImportPreviewResponse,
  distributionRule,
  duplicateGroup,
  leadCadence,
  leadEvent,
  mergeLeadsResponse,
  savedView,
  sendTemplateResponse,
  unmergeLeadsResponse,
  updateLeadRequest,
  z,
  type BulkLeadPatch,
  type BulkUndoRequest,
  type ConvertLeadRequest,
  type CreateAutomationRequest,
  type CreateCadenceRequest,
  type CreateDistributionRequest,
  type CreateLeadRequest,
  type CreateSavedViewRequest,
  type CreateTemplateRequest,
  type CrmStatsQuery,
  type CsvImportCommitRequest,
  type MergeLeadsRequest,
  type SendTemplateRequest,
  type UpdateAutomationRequest,
  type UpdateCadenceRequest,
  type UpdateCrmSettingsRequest,
  type UpdateDistributionRequest,
  type UpdateLeadRequest,
  type UpdateSavedViewRequest,
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

export function useAutomations() {
  return useCrmQuery(['automations'], () => callApi('/crm/automations', { responseSchema: automationRule.array() }), 60_000)
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
      callApi('/crm/distribution', { method: 'POST', body: input, responseSchema: z.object({ id: z.string() }) }),
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

export function useCreateAutomation() {
  return useCrmMutation(
    (input: CreateAutomationRequest) =>
      callApi('/crm/automations', {
        method: 'POST',
        body: createAutomationRequest.parse(input),
        responseSchema: automationRule,
      }),
    'Rule saved',
  )
}

export function useUpdateAutomation() {
  return useCrmMutation(
    ({ id, patch }: { id: string; patch: UpdateAutomationRequest }) =>
      callApi(`/crm/automations/${id}`, { method: 'PATCH', body: patch, responseSchema: noContent }),
  )
}

export function useDeleteAutomation() {
  return useCrmMutation(
    (id: string) => callApi(`/crm/automations/${id}`, { method: 'DELETE', responseSchema: noContent }),
    'Rule deleted',
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
        responseSchema: z.object({ id: z.string() }),
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
        responseSchema: z.object({ next_at: z.string().nullable() }),
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
