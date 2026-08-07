import { MODULES, type ModuleAction, type ModuleKey } from './modules'
import { getProfile } from './profiles'
import type { AppRole, StaffRole } from './roles'

export interface AccessOverride {
  permission_key: string
  enabled: boolean
}

export interface AccessInput {
  role: AppRole
  /** True for the studio owner (super_admin) — bypasses every check. */
  isOwner: boolean
  /** Assigned custom profile key, or null to fall back to role defaults. */
  profileKey?: string | null
  /** Per-permission overrides layered on top of the profile. */
  overrides?: ReadonlyArray<AccessOverride>
}

/**
 * Compose the effective permission set from a profile + overrides.
 * Returns null when no profile is assigned (caller falls back to role defaults).
 *
 * Override keys are free-form:
 *   - a bare module key ("clients") grants View on that module
 *   - "{module}.{action}" ("clients.edit") grants that specific action
 */
export function composeEffective(
  profileKey: string | null | undefined,
  overrides: ReadonlyArray<AccessOverride> = [],
): Set<string> | null {
  const profile = getProfile(profileKey)
  if (!profile) return null
  const set = new Set<string>(profile.permissions)
  for (const o of overrides) {
    if (!o.permission_key) continue
    if (o.enabled) set.add(o.permission_key)
    else set.delete(o.permission_key)
  }
  return set
}

const isStaffRole = (role: AppRole): role is StaffRole =>
  role === 'admin' || role === 'manager' || role === 'employee'

/**
 * The three-question resolver from the security model:
 *   1. Is this the studio owner? → allow everything, stop.
 *   2. Has the owner given them a profile? → use ONLY that profile ∪ overrides;
 *      ignore the job title completely.
 *   3. Neither? → fall back to the role-default map.
 */
export function resolveAccess(input: AccessInput) {
  const { role, isOwner } = input
  const effective = composeEffective(input.profileKey, input.overrides ?? [])

  function hasModule(key: ModuleKey): boolean {
    if (isOwner) return true // Q1
    if (effective) return effective.has(key) // Q2 — profile replaces role
    // Q3 — role defaults
    const mod = MODULES[key]
    if (!mod || mod.superAdminOnly) return false
    if (!isStaffRole(role)) return false
    return mod.defaultVisibility[role]
  }

  function hasAction(key: ModuleKey, action: ModuleAction): boolean {
    if (isOwner) return true // Q1
    if (effective) {
      // Q2 — bare module key implies View; other actions need "{module}.{action}"
      if (action === 'view') return effective.has(key)
      return effective.has(`${key}.${action}`)
    }
    // Q3 — role defaults: admin/manager get full CRUD on visible modules;
    // employees get View only.
    if (!hasModule(key)) return false
    if (role === 'admin' || role === 'manager') return true
    return action === 'view'
  }

  return { hasModule, hasAction, effective }
}

export type ResolvedAccess = ReturnType<typeof resolveAccess>
