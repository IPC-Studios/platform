import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import {
  addMemberRequest,
  addMemberResponse,
  assignRolesRequest,
  createInvitationRequest,
  directoryMember,
  employeeRole,
  invitation,
  invitationLink,
  updateMemberRequest,
  upsertEmployeeRoleRequest,
  z,
  type AddMemberRequest,
  type AssignRolesRequest,
  type CreateInvitationRequest,
  type UpdateMemberRequest,
  type UpsertEmployeeRoleRequest,
} from '@ipc/contracts'
import { callApi } from '@/shared/api/client'
import { useAuth } from '@/shared/auth/AuthProvider'
import { useAccess } from '@/shared/auth/useAccess'

const directoryList = directoryMember.array()
const rolesList = employeeRole.array()
const invitationsList = invitation.array()
const ok = z.object({ ok: z.boolean() })

/** Everything the Team page reads and writes. One key prefix: ['team']. */
export function useDirectory() {
  const { session } = useAuth()
  const access = useAccess()
  return useQuery({
    queryKey: ['team', 'directory'],
    queryFn: () => callApi('/team/directory', { responseSchema: directoryList }),
    enabled: !!session && access.hasModule('team_directory'),
    staleTime: 30_000,
  })
}

export function useEmployeeRoles() {
  const { session } = useAuth()
  const access = useAccess()
  return useQuery({
    queryKey: ['team', 'roles'],
    queryFn: () => callApi('/team/roles', { responseSchema: rolesList }),
    enabled: !!session && access.hasModule('team_roles'),
    staleTime: 60_000,
  })
}

/** Owner-only: the invitations panel is hidden outright for everyone else. */
export function useInvitations() {
  const { session } = useAuth()
  return useQuery({
    queryKey: ['team', 'invitations'],
    queryFn: () => callApi('/team/invitations', { responseSchema: invitationsList }),
    enabled: !!session?.is_owner,
    staleTime: 30_000,
  })
}

function useTeamMutation<TInput, TOutput>(
  fn: (input: TInput) => Promise<TOutput>,
  success?: string | ((out: TOutput, input: TInput) => string),
) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: fn,
    onSuccess: (out, input) => {
      const msg = typeof success === 'function' ? success(out, input) : success
      if (msg) toast.success(msg)
      void qc.invalidateQueries({ queryKey: ['team'] })
    },
    onError: (e: Error) => toast.error(e.message),
  })
}

export function useAddMember() {
  return useTeamMutation(
    (input: AddMemberRequest) =>
      callApi('/team/members', {
        method: 'POST',
        body: addMemberRequest.parse(input),
        responseSchema: addMemberResponse,
      }),
    (_out, input) => `${input.name} added to the team`,
  )
}

export function useUpdateMember() {
  return useTeamMutation(
    ({ userId, patch }: { userId: string; patch: UpdateMemberRequest }) =>
      callApi(`/team/members/${userId}`, {
        method: 'PATCH',
        body: updateMemberRequest.parse(patch),
        responseSchema: ok,
      }),
    'Team member updated',
  )
}

export function useRemoveMember() {
  return useTeamMutation(
    (userId: string) => callApi(`/team/members/${userId}`, { method: 'DELETE', responseSchema: ok }),
    'Team member removed',
  )
}

export function useAssignRoles() {
  return useTeamMutation(
    ({ userId, roles }: { userId: string; roles: AssignRolesRequest }) =>
      callApi(`/team/members/${userId}/roles`, {
        method: 'PATCH',
        body: assignRolesRequest.parse(roles),
        responseSchema: ok,
      }),
    'Roles updated',
  )
}

export function useSendReset() {
  return useMutation({
    mutationFn: (userId: string) =>
      callApi(`/team/members/${userId}/reset-password`, { method: 'POST', responseSchema: ok }),
    onError: (e: Error) => toast.error(e.message),
  })
}

export function useCreateRole() {
  return useTeamMutation(
    (input: UpsertEmployeeRoleRequest) =>
      callApi('/team/roles', {
        method: 'POST',
        body: upsertEmployeeRoleRequest.parse(input),
        responseSchema: employeeRole,
      }),
    'Role created',
  )
}

export function useUpdateRole() {
  return useTeamMutation(
    ({ id, patch }: { id: string; patch: UpsertEmployeeRoleRequest }) =>
      callApi(`/team/roles/${id}`, {
        method: 'PATCH',
        body: upsertEmployeeRoleRequest.parse(patch),
        responseSchema: ok,
      }),
    'Role updated',
  )
}

export function useDeleteRole() {
  return useTeamMutation(
    (id: string) => callApi(`/team/roles/${id}`, { method: 'DELETE', responseSchema: ok }),
    'Role deleted',
  )
}

export function useCreateInvitation() {
  return useTeamMutation(
    (input: CreateInvitationRequest) =>
      callApi('/team/invitations', {
        method: 'POST',
        body: createInvitationRequest.parse(input),
        responseSchema: invitationLink,
      }),
    'Invitation sent',
  )
}

export function useResendInvitation() {
  return useTeamMutation(
    (id: string) =>
      callApi(`/team/invitations/${id}/resend`, { method: 'POST', responseSchema: invitationLink }),
    'Invitation resent',
  )
}

export function useRevokeInvitation() {
  return useTeamMutation(
    (id: string) => callApi(`/team/invitations/${id}`, { method: 'DELETE', responseSchema: ok }),
    'Invitation revoked',
  )
}
