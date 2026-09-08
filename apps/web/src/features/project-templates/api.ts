import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import {
  projectTemplateList,
  z,
  type CreateProjectTemplateRequest,
} from '@ipc/contracts'
import { callApi } from '@/shared/api/client'
import { useAuth } from '@/shared/auth/AuthProvider'
import { useAccess } from '@/shared/auth/useAccess'

const created = z.object({ id: z.string().uuid() })
/** Mutation responses whose body the UI discards; unknown keeps `any` out of the app. */
const anySchema = z.unknown()

export function useProjectTemplates() {
  const { session } = useAuth()
  const access = useAccess()
  return useQuery({
    queryKey: ['projects', 'templates'],
    queryFn: () => callApi('/projects/templates', { responseSchema: projectTemplateList }),
    enabled: !!session && access.hasModule('projects'),
    staleTime: 15_000,
  })
}

function useTemplateMutation<TArgs, TResult>(fn: (a: TArgs) => Promise<TResult>, message: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: fn,
    onSuccess: () => {
      toast.success(message)
      void qc.invalidateQueries({ queryKey: ['projects', 'templates'] })
    },
  })
}

export function useSaveProjectTemplate() {
  return useTemplateMutation(
    ({ id, body }: { id?: string | undefined; body: CreateProjectTemplateRequest }) =>
      callApi(id ? `/projects/templates/${id}` : '/projects/templates', {
        method: id ? 'PATCH' : 'POST',
        body,
        responseSchema: id ? anySchema : created,
      }),
    'Template saved',
  )
}

export function useDeleteProjectTemplate() {
  return useTemplateMutation(
    (id: string) => callApi(`/projects/templates/${id}`, { method: 'DELETE', responseSchema: anySchema }),
    'Template deleted',
  )
}

export function useApplyProjectTemplate() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ templateId, body }: { templateId: string; body: { name: string; client_id?: string | undefined; start_date?: string | undefined } }) =>
      callApi(`/projects/templates/${templateId}/apply`, {
        method: 'POST',
        body,
        responseSchema: z.object({ project_id: z.string().uuid() }),
      }),
    onSuccess: () => {
      toast.success('Project created from template')
      void qc.invalidateQueries({ queryKey: ['projects'] })
    },
  })
}
