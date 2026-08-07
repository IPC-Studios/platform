/**
 * The fixed role ladder. Fewer powers as you descend.
 * `platform_admin` is the company selling the software (cross-tenant).
 * `super_admin` is the studio owner — bypasses every check inside their tenant.
 * `none` = has an account row but no assigned role yet.
 */
export type AppRole = 'platform_admin' | 'super_admin' | 'admin' | 'manager' | 'employee' | 'none'

/** Roles that can actually be assigned a default module map (excludes owner + platform). */
export type StaffRole = 'admin' | 'manager' | 'employee'

export const ROLE_RANK: Readonly<Record<AppRole, number>> = {
  platform_admin: 100,
  super_admin: 90,
  admin: 60,
  manager: 40,
  employee: 20,
  none: 0,
}
