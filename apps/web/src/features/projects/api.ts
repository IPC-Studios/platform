import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { z } from '@ipc/contracts'
import {
  createProjectRequest,
  projectDetail,
  projectListItem,
  type CreateProjectRequest,
  type DeliverableInput,
  type PaymentInput,
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
    onSuccess: () => qc.invalidateQueries({ queryKey: ['projects'] }),
  })
}

const anySchema = z.any()

/** Invalidate both the detail and the list after a project mutation. */
function useProjectMutation(id: string) {
  const qc = useQueryClient()
  return () => {
    void qc.invalidateQueries({ queryKey: ['projects', id] })
    void qc.invalidateQueries({ queryKey: ['projects'] })
  }
}

export function useUpdateProject(id: string) {
  const onSuccess = useProjectMutation(id)
  return useMutation({
    mutationFn: (input: UpdateProjectRequest) =>
      callApi(`/projects/${id}`, { method: 'PATCH', body: input, responseSchema: anySchema }),
    onSuccess,
  })
}

export function useAddDeliverable(id: string) {
  const onSuccess = useProjectMutation(id)
  return useMutation({
    mutationFn: (input: DeliverableInput) =>
      callApi(`/projects/${id}/deliverables`, { method: 'POST', body: input, responseSchema: anySchema }),
    onSuccess,
  })
}

export function useDeleteDeliverable(id: string) {
  const onSuccess = useProjectMutation(id)
  return useMutation({
    mutationFn: (deliverableId: string) =>
      callApi(`/projects/${id}/deliverables/${deliverableId}`, {
        method: 'DELETE',
        responseSchema: anySchema,
      }),
    onSuccess,
  })
}

export function useAddPayment(id: string) {
  const onSuccess = useProjectMutation(id)
  return useMutation({
    mutationFn: (input: PaymentInput) =>
      callApi(`/projects/${id}/payments`, { method: 'POST', body: input, responseSchema: anySchema }),
    onSuccess,
  })
}
