import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import {
  serviceOption,
  shootPreset,
  z,
  type SaveShootPresetRequest,
  type ShootPresetKind,
} from '@ipc/contracts'
import { callApi } from '@/shared/api/client'
import { useAuth } from '@/shared/auth/AuthProvider'
import { useAccess } from '@/shared/auth/useAccess'

const services = serviceOption.array()
const presets = shootPreset.array()
const anySchema = z.any()

/**
 * Every service this studio has asked for before, for the requirement picker.
 *
 * There is no services admin screen: the list is a by-product of booking
 * shoots, so it starts empty and fills itself with whatever the studio
 * actually books. Cached for a while — it changes about once a season.
 */
export function useServices() {
  const { session } = useAuth()
  const access = useAccess()
  return useQuery({
    queryKey: ['shoots', 'services'],
    queryFn: () => callApi('/shoots/services', { responseSchema: services }),
    enabled: !!session && access.hasModule('projects'),
    staleTime: 5 * 60_000,
  })
}

export function useShootPresets(kind: ShootPresetKind) {
  const { session } = useAuth()
  const access = useAccess()
  return useQuery({
    queryKey: ['shoots', 'presets', kind],
    queryFn: () => callApi(`/shoots/presets?kind=${kind}`, { responseSchema: presets }),
    enabled: !!session && access.hasModule('projects'),
    staleTime: 5 * 60_000,
  })
}

export function useSaveShootPreset() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: SaveShootPresetRequest) =>
      callApi('/shoots/presets', { method: 'POST', body: input, responseSchema: shootPreset }),
    onSuccess: (saved) => {
      toast.success(`Saved “${saved.name}”`)
      void qc.invalidateQueries({ queryKey: ['shoots', 'presets'] })
    },
  })
}

export function useDeleteShootPreset() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) =>
      callApi(`/shoots/presets/${id}`, { method: 'DELETE', responseSchema: anySchema }),
    onSuccess: () => {
      toast.success('Preset removed')
      void qc.invalidateQueries({ queryKey: ['shoots', 'presets'] })
    },
  })
}
