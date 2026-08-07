import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { client, createClientRequest, type CreateClientRequest } from '@ipc/contracts'
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
    onSuccess: () => qc.invalidateQueries({ queryKey: ['clients'] }),
  })
}
