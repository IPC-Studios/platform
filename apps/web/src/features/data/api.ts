import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { z } from '@ipc/contracts'
import { dataRecord, type CreateDataRecordRequest } from '@ipc/contracts'
import { toast } from 'sonner'
import { callApi } from '@/shared/api/client'
import { useAuth } from '@/shared/auth/AuthProvider'
import { useAccess } from '@/shared/auth/useAccess'

const list = dataRecord.array()
const anySchema = z.any()

export function useDataRecords() {
  const { session } = useAuth()
  const access = useAccess()
  return useQuery({
    queryKey: ['data'],
    queryFn: () => callApi('/data', { responseSchema: list }),
    enabled: !!session && access.hasModule('projects'),
    staleTime: 15_000,
  })
}

export function useVerifyData() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, track }: { id: string; track: 'primary' | 'backup' }) =>
      callApi(`/data/${id}/verify`, { method: 'POST', body: { track }, responseSchema: anySchema }),
    onSuccess: () => {
      toast.success('Verified')
      void qc.invalidateQueries({ queryKey: ['data'] })
    },
  })
}

export function useCreateDataRecord() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: CreateDataRecordRequest) =>
      callApi('/data', { method: 'POST', body: input, responseSchema: dataRecord }),
    onSuccess: () => {
      toast.success('Card logged')
      void qc.invalidateQueries({ queryKey: ['data'] })
    },
  })
}
