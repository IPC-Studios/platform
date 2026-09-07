import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { z } from '@ipc/contracts'
import {
  createProjectRequest,
  deliverableSet,
  issuedLink,
  projectDetail,
  projectListItem,
  type CreateProjectRequest,
  type DeliverableInput,
  type IssueQuotationRequest,
  type PaymentInput,
  type SaveDeliverableSetRequest,
  type UpdateProjectRequest,
} from '@ipc/contracts'
import { callApi } from '@/shared/api/client'
import { useAuth } from '@/shared/auth/AuthProvider'
import { useAccess } from '@/shared/auth/useAccess'

const projectsList = projectListItem.array()
const createResponse = z.object({ id: z.string().uuid() })

export function useProjects() {
  const { session } = useAuth()
  const access = useAccess()
  return useQuery({
    queryKey: ['projects'],
    queryFn: () => callApi('/projects', { responseSchema: projectsList }),
    enabled: !!session && access.hasModule('projects'),
    staleTime: 30_000,
  })
}

export function useProject(id: string) {
  const { session } = useAuth()
  return useQuery({
    queryKey: ['projects', id],
    queryFn: () => callApi(`/projects/${id}`, { responseSchema: projectDetail }),
    enabled: !!session && !!id,
  })
}

export function useCreateProject() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: CreateProjectRequest) =>
      callApi('/projects', {
        method: 'POST',
        body: createProjectRequest.parse(input),
        responseSchema: createResponse,
      }),
    onSuccess: () => {
      toast.success('Project created')
      void qc.invalidateQueries({ queryKey: ['projects'] })
    },
  })
}

const anySchema = z.any()

/** Invalidate both the detail and the list after a project mutation. */
function useProjectMutation(id: string, message: string) {
  const qc = useQueryClient()
  return () => {
    toast.success(message)
    void qc.invalidateQueries({ queryKey: ['projects', id] })
    void qc.invalidateQueries({ queryKey: ['projects'] })
  }
}

export function useUpdateProject(id: string) {
  return useMutation({
    mutationFn: (input: UpdateProjectRequest) =>
      callApi(`/projects/${id}`, { method: 'PATCH', body: input, responseSchema: anySchema }),
    onSuccess: useProjectMutation(id, 'Project updated'),
  })
}

export function useAddDeliverable(id: string) {
  return useMutation({
    mutationFn: (input: DeliverableInput) =>
      callApi(`/projects/${id}/deliverables`, { method: 'POST', body: input, responseSchema: anySchema }),
    onSuccess: useProjectMutation(id, 'Deliverable added'),
  })
}

export function useDeleteDeliverable(id: string) {
  return useMutation({
    mutationFn: (deliverableId: string) =>
      callApi(`/projects/${id}/deliverables/${deliverableId}`, {
        method: 'DELETE',
        responseSchema: anySchema,
      }),
    onSuccess: useProjectMutation(id, 'Deliverable removed'),
  })
}

export function useAddPayment(id: string) {
  return useMutation({
    mutationFn: (input: PaymentInput) =>
      callApi(`/projects/${id}/payments`, { method: 'POST', body: input, responseSchema: anySchema }),
    onSuccess: useProjectMutation(id, 'Payment recorded'),
  })
}

const setsList = deliverableSet.array()

/**
 * The packages this studio quotes from, shared with the whole team.
 *
 * Sets live on the server precisely because they are a shared decision — what
 * "Premium" includes is the studio's answer, not one laptop's. (The lead-time
 * memory beside them on the same step is the opposite, and stays local.)
 */
export function useDeliverableSets() {
  const { session } = useAuth()
  const access = useAccess()
  return useQuery({
    queryKey: ['projects', 'deliverable-sets'],
    queryFn: () => callApi('/projects/deliverable-sets', { responseSchema: setsList }),
    enabled: !!session && access.hasModule('projects'),
    staleTime: 5 * 60_000,
  })
}

export function useSaveDeliverableSet() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: SaveDeliverableSetRequest) =>
      callApi('/projects/deliverable-sets', {
        method: 'POST',
        body: input,
        responseSchema: deliverableSet,
      }),
    onSuccess: (saved) => {
      toast.success(`Saved “${saved.name}”`)
      void qc.invalidateQueries({ queryKey: ['projects', 'deliverable-sets'] })
    },
  })
}

export function useDeleteDeliverableSet() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) =>
      callApi(`/projects/deliverable-sets/${id}`, { method: 'DELETE', responseSchema: anySchema }),
    onSuccess: () => {
      toast.success('Set removed')
      void qc.invalidateQueries({ queryKey: ['projects', 'deliverable-sets'] })
    },
  })
}

/**
 * Turn a project into a quotation link.
 *
 * Shared by the project page and the "what next?" dialog the wizard shows, so
 * a quotation issued from either place is built the same way — the server
 * snapshots the prices, and what comes back is the link to send.
 */
export function useIssueQuotation() {
  return useMutation({
    mutationFn: (input: IssueQuotationRequest) =>
      callApi('/documents/quotations', {
        method: 'POST',
        body: input,
        responseSchema: issuedLink,
      }),
  })
}

/**
 * Delete a project. Refused by the API once payments exist, so the error it
 * throws is the message worth showing.
 */
export function useDeleteProject() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) =>
      callApi(`/projects/${id}`, { method: 'DELETE', responseSchema: anySchema }),
    onSuccess: () => {
      toast.success('Project deleted')
      void qc.invalidateQueries({ queryKey: ['projects'] })
    },
  })
}
