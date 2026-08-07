import { describe, expect, it } from 'vitest'
import { MODULES, MODULE_KEYS, type ModuleAction, type ModuleKey } from './modules'
import { SYSTEM_PROFILES } from './profiles'
import { resolveAccess } from './resolve'
import type { StaffRole } from './roles'

const STAFF: StaffRole[] = ['admin', 'manager', 'employee']
const ACTIONS: ModuleAction[] = ['view', 'create', 'edit', 'delete']

/**
 * The Phase 2 exit criterion: a permission decision for EVERY
 * role × module × action combination, checked against an independent
 * expectation (not the resolver's own code path).
 */
describe('permission matrix — owner', () => {
  const owner = resolveAccess({ role: 'super_admin', isOwner: true })
  for (const key of MODULE_KEYS) {
    for (const action of ACTIONS) {
      it(`owner may ${action} ${key}`, () => {
        expect(owner.hasModule(key)).toBe(true)
        expect(owner.hasAction(key, action)).toBe(true)
      })
    }
  }
})

describe('permission matrix — role defaults', () => {
  for (const role of STAFF) {
    const access = resolveAccess({ role, isOwner: false })
    for (const key of MODULE_KEYS) {
      const mod = MODULES[key]
      // Independent expectation: visible iff registry says so AND not owner-only.
      const expectVisible = !mod.superAdminOnly && mod.defaultVisibility[role]

      it(`${role} module visibility for ${key}`, () => {
        expect(access.hasModule(key)).toBe(expectVisible)
      })

      for (const action of ACTIONS) {
        const expectAction = !expectVisible
          ? false
          : role === 'employee'
            ? action === 'view'
            : true // admin & manager get full CRUD on visible modules
        it(`${role} may${expectAction ? '' : ' NOT'} ${action} ${key}`, () => {
          expect(access.hasAction(key, action)).toBe(expectAction)
        })
      }
    }
  }
})

describe('the surprising rule — no staff role sees money/settings by default', () => {
  const ownerOnly = MODULE_KEYS.filter((k) => MODULES[k].superAdminOnly)
  for (const role of STAFF) {
    const access = resolveAccess({ role, isOwner: false })
    for (const key of ownerOnly) {
      it(`${role} is denied owner-only module ${key}`, () => {
        expect(access.hasModule(key)).toBe(false)
      })
    }
  }
})

describe('profiles replace the job title entirely', () => {
  const sample: ModuleKey[] = ['dashboard', 'projects', 'clients', 'money', 'team', 'crm', 'settings']
  for (const [profileKey, profile] of Object.entries(SYSTEM_PROFILES)) {
    // Apply the profile to an admin AND an employee — outcome must be identical,
    // proving the profile, not the role, decides.
    for (const role of ['admin', 'employee'] as StaffRole[]) {
      const access = resolveAccess({ role, isOwner: false, profileKey })
      for (const key of sample) {
        const expected = profile.permissions.includes(key)
        it(`${profileKey} on ${role}: module ${key} = ${expected}`, () => {
          expect(access.hasModule(key)).toBe(expected)
        })
      }
    }
  }
})
