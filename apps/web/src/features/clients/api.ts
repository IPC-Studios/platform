import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { z, client, projectListItem, createClientRequest, updateClientRequest, type Client, type CreateClientRequest, type UpdateClientRequest } from '@ipc/contracts'
import { ApiError } from '@/shared/api/client'

const noContent = z.unknown()
import { callApi } from '@/shared/api/client'
import { useAuth } from '@/shared/auth/AuthProvider'
import { useAccess } from '@/shared/auth/useAccess'

const clientsList = client.array()
const clientPage = z.object({ items: clientsList, total: z.number().int(), page: z.number().int(), page_size: z.number().int() })
type ClientPage = z.infer<typeof clientPage>

export interface ClientDirectoryQuery {
  search?: string
  sort?: 'recent' | 'name' | 'city'
  /** Client-side filter (free-text tag); the server only filters search/sort. */
  relation?: string
  /** Client-side YYYY-MM-DD range on created_at. */
  created_from?: string
  created_to?: string
  page?: number
  page_size?: number
}

/** Legacy array shape (no params) — kept for existing callers. */
export function useClients(query?: ClientDirectoryQuery) {
  const { session } = useAuth()
  const access = useAccess()
  const hasParams = !!query && Object.keys(query).length > 0
  return useQuery({
    queryKey: ['clients', query ?? {}],
    queryFn: async (): Promise<Client[] | ClientPage> => {
      if (!hasParams) return callApi('/clients', { responseSchema: clientsList })
      const q = query ?? {}
      const params = new URLSearchParams()
      params.set('page', String(q.page ?? 1))
      params.set('page_size', String(q.page_size ?? 25))
      if (q.search?.trim()) params.set('search', q.search.trim())
      if (q.sort) params.set('sort', q.sort)
      const page: ClientPage = await callApi(`/clients?${params.toString()}`, { responseSchema: clientPage })
      // Relation + date range are free-text/client-side filters.
      const rel = q.relation?.trim().toLowerCase()
      const from = q.created_from?.trim()
      const to = q.created_to?.trim()
      if (!rel && !from && !to) return page
      const items = page.items.filter((c) => {
        if (rel && !(c.relation ?? '').toLowerCase().includes(rel)) return false
        const day = c.created_at.slice(0, 10)
        if (from && day < from) return false
        if (to && day > to) return false
        return true
      })
      return { ...page, items }
    },
    enabled: !!session && access.hasModule('clients'),
    staleTime: 30_000,
  })
}

export function useClientsPage(query: { page: number; page_size: number; search?: string; sort?: string }) {
  const { session } = useAuth()
  const access = useAccess()
  return useQuery({
    queryKey: ['clients', 'page', query],
    queryFn: () => {
      const params = new URLSearchParams({ page: String(query.page), page_size: String(query.page_size) })
      if (query.search) params.set('search', query.search)
      if (query.sort) params.set('sort', query.sort)
      return callApi(`/clients?${params.toString()}`, { responseSchema: clientPage })
    },
    enabled: !!session && access.hasModule('clients'),
    staleTime: 30_000,
  })
}

export function useClient(id: string) {
  const { session } = useAuth()
  return useQuery({
    queryKey: ['clients', id],
    queryFn: () => callApi(`/clients/${id}`, { responseSchema: client }),
    enabled: !!session && !!id,
  })
}

export function useClientProjects(id: string) {
  const { session } = useAuth()
  return useQuery({
    queryKey: ['clients', id, 'projects'],
    queryFn: () => callApi(`/clients/${id}/projects`, { responseSchema: projectListItem.array() }),
    enabled: !!session && !!id,
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
      }).catch((err) => {
        // 409 duplicate-by-phone: surface the existing client with a link.
        if (err instanceof ApiError && err.status === 409) {
          try {
            const body = JSON.parse(err.message) as { existing_client?: unknown }
            void body
          } catch { /* message is already human-readable */ }
        }
        throw err
      }),
    onSuccess: () => {
      toast.success('Client added')
      void qc.invalidateQueries({ queryKey: ['clients'] })
    },
    onError: (err) => {
      if (err instanceof ApiError && err.status === 409) {
        toast.error('A client with this phone already exists. Open the existing client instead.', { action: { label: 'View clients', onClick: () => { window.location.hash = '#/clients' } } })
      }
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
