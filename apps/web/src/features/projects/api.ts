import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { z } from '@ipc/contracts'
import {
  createProjectRequest,
  projectDetail,
  projectListItem,
  type CreateProjectRequest,
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
