import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { z, client, createClientRequest, updateClientRequest, type CreateClientRequest, type UpdateClientRequest } from '@ipc/contracts'

const noContent = z.unknown()
import { callApi } from '@/shared/api/client'
import { useAuth } from '@/shared/auth/AuthProvider'
import { useAccess } from '@/shared/auth/useAccess'

const clientsList = client.array()

export function useClients() {
  const { session } = useAuth()
  const access = useAccess()
  return useQuery({
    queryKey: ['clients'],
    queryFn: () => callApi('/clients', { responseSchema: clientsList }),
    enabled: !!session && access.hasModule('clients'),
    staleTime: 30_000,
  })
}

export function useCreateClient() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: CreateClientRequest) =>
      callApi('/clients', {
        method: 'POST',
        body: createClientRequest.parse(input),
        responseSchema: client,
      }),
    onSuccess: () => {
      toast.success('Client added')
      void qc.invalidateQueries({ queryKey: ['clients'] })
    },
  })
}

/** Same endpoint shape whether this is the first save or the fifth. */
export function useUpdateClient(id: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: UpdateClientRequest) =>
      callApi(`/clients/${id}`, {
        method: 'PATCH',
        body: updateClientRequest.parse(input),
        responseSchema: client,
      }),
    onSuccess: () => {
      toast.success('Client updated')
      void qc.invalidateQueries({ queryKey: ['clients'] })
    },
  })
}

export function useDeleteClient() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => callApi(`/clients/${id}`, { method: 'DELETE', responseSchema: noContent }),
    onSuccess: () => {
      toast.success('Client deleted')
      void qc.invalidateQueries({ queryKey: ['clients'] })
    },
  })
}
