import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { z } from '@ipc/contracts'
import { teamSlot, teamMember, type BookSlotRequest } from '@ipc/contracts'
import { toast } from 'sonner'
import { callApi, ApiError } from '@/shared/api/client'
import { useAuth } from '@/shared/auth/AuthProvider'

const slots = teamSlot.array()
const members = teamMember.array()

export function useSlots() {
  const { session } = useAuth()
  return useQuery({
    queryKey: ['allocation'],
    queryFn: () => callApi('/allocation', { responseSchema: slots }),
    enabled: !!session,
    staleTime: 15_000,
  })
}

export function useMembers() {
  const { session } = useAuth()
  return useQuery({
    queryKey: ['team', 'members'],
    queryFn: () => callApi('/team/members', { responseSchema: members }),
    enabled: !!session,
    staleTime: 60_000,
  })
}

export function useBookSlot() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: BookSlotRequest) =>
      callApi('/allocation', {
        method: 'POST',
        body: input,
        responseSchema: z.object({ id: z.string() }),
      }),
    onSuccess: () => {
      toast.success('Crew booked')
      void qc.invalidateQueries({ queryKey: ['allocation'] })
    },
  })
}

export { ApiError }
