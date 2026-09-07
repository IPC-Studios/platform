import { useAccess } from '@/shared/auth/useAccess'

/**
 * The CRM's four grants, read once per screen.
 *
 * Delete is a separate grant from edit, and the two had drifted: every trash
 * icon in the CRM was gated on `crm:edit` while sixteen endpoints ask for
 * `crm:delete`. Someone with edit-but-not-delete saw a full set of delete
 * buttons and got a permission error from each one. Reading all four here
 * keeps a screen from offering what the API will refuse.
 */
export function useCrmAccess(): {
  canView: boolean
  canCreate: boolean
  canEdit: boolean
  canDelete: boolean
} {
  const access = useAccess()
  return {
    canView: access.hasModule('crm'),
    canCreate: access.hasAction('crm', 'create'),
    canEdit: access.hasAction('crm', 'edit'),
    canDelete: access.hasAction('crm', 'delete'),
  }
}
