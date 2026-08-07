import { describe, expect, it } from 'vitest'
import { resolveAccess } from './resolve'

describe('resolveAccess — three-question resolution', () => {
  it('Q1: owner sees and does everything, sensitive included', () => {
    const a = resolveAccess({ role: 'super_admin', isOwner: true })
    expect(a.hasModule('money')).toBe(true)
    expect(a.hasModule('settings')).toBe(true)
    expect(a.hasAction('financials', 'delete')).toBe(true)
  })

  it('Q3: plain admin cannot see money/settings by default', () => {
    const a = resolveAccess({ role: 'admin', isOwner: false })
    expect(a.hasModule('money')).toBe(false)
    expect(a.hasModule('settings')).toBe(false)
    // ...but can see and fully manage projects
    expect(a.hasModule('projects')).toBe(true)
    expect(a.hasAction('projects', 'delete')).toBe(true)
  })

  it('Q3: employee gets View only on visible modules', () => {
    const a = resolveAccess({ role: 'employee', isOwner: false })
    expect(a.hasModule('projects')).toBe(true)
    expect(a.hasAction('projects', 'view')).toBe(true)
    expect(a.hasAction('projects', 'edit')).toBe(false)
    expect(a.hasModule('clients')).toBe(false)
  })

  it('Q2: a profile fully replaces the job title', () => {
    // An admin handed the finance_manager badge: gains money, but the profile
    // does NOT include team — so team is now hidden despite being admin.
    const a = resolveAccess({ role: 'admin', isOwner: false, profileKey: 'finance_manager' })
    expect(a.hasModule('money')).toBe(true)
    expect(a.hasModule('financials')).toBe(true)
    expect(a.hasModule('team')).toBe(false)
  })

  it('Q2: overrides layer on top of the profile', () => {
    const a = resolveAccess({
      role: 'employee',
      isOwner: false,
      profileKey: 'photographer',
      overrides: [
        { permission_key: 'clients', enabled: true },
        { permission_key: 'clients.edit', enabled: true },
        { permission_key: 'projects', enabled: false },
      ],
    })
    expect(a.hasModule('clients')).toBe(true)
    expect(a.hasAction('clients', 'edit')).toBe(true)
    expect(a.hasModule('projects')).toBe(false) // removed by override
  })

  it('unknown profile key falls through to role defaults, not deny-all', () => {
    const a = resolveAccess({ role: 'manager', isOwner: false, profileKey: 'does_not_exist' })
    expect(a.effective).toBeNull()
    expect(a.hasModule('crm')).toBe(true)
  })
})
