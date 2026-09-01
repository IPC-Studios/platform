import { z } from 'zod'
import { uuid, isoDateTime, money } from './shared/primitives'

/**
 * How a person is engaged. Drives which fields the directory asks for and how
 * the studio thinks about their cost: salaried staff vs per-shoot crew.
 */
export const engagementType = z.enum(['in_house', 'freelancer'])
export type EngagementType = z.infer<typeof engagementType>

export const memberStatus = z.enum(['active', 'inactive', 'pending'])

/** The app-role ladder an owner may hand out. Owner (super_admin) is not one. */
export const assignableRole = z.enum(['admin', 'manager', 'employee'])
export type AssignableRole = z.infer<typeof assignableRole>

/** A studio's own job roles — Photographer, Editor, Drone Op… */
export const employeeRole = z.object({
  id: uuid,
  type_name: z.string(),
  role_code: z.string(),
  member_count: z.number().int(),
})
export type EmployeeRole = z.infer<typeof employeeRole>

export const upsertEmployeeRoleRequest = z.object({
  type_name: z.string().trim().min(2).max(60),
  role_code: z
    .string()
    .trim()
    .min(2)
    .max(40)
    .regex(/^[a-z0-9_]+$/, 'lowercase letters, numbers and underscores only'),
})
export type UpsertEmployeeRoleRequest = z.infer<typeof upsertEmployeeRoleRequest>

export const assignRolesRequest = z.object({ role_ids: z.array(uuid).max(20).default([]) })
export type AssignRolesRequest = z.infer<typeof assignRolesRequest>

/**
 * Full directory row.
 *
 * `email` is nullable — a directory-only freelancer may be a phone number and
 * nothing more. `salary` is nullable for a second reason: the API blanks it for
 * callers without the team_salaries module, so an absent figure means "not
 * yours to see" as often as "not set".
 */
export const directoryMember = z.object({
  user_id: uuid,
  name: z.string(),
  email: z.string().nullable(),
  role: z.string(),
  phone: z.string().nullable(),
  alternate_phone: z.string().nullable(),
  status: z.string(),
  engagement_type: z.string().nullable(),
  login_enabled: z.boolean(),
  salary: z.number().nullable(),
  address: z.string().nullable(),
  created_at: isoDateTime,
  role_names: z.array(z.string()),
  role_ids: z.array(uuid),
})
export type DirectoryMember = z.infer<typeof directoryMember>

/**
 * Add a member. The wizard's six steps collapse into this one payload.
 *
 * `create_login` is the fork: with it, email + password are required and the
 * person can sign in; without it they are directory-only — bookable, assignable,
 * with no identity to phish. `salary` is only ever accepted from an owner (the
 * API re-checks; a payload alone must not be able to write compensation).
 */
export const addMemberRequest = z
  .object({
    engagement_type: engagementType.default('in_house'),
    create_login: z.boolean().default(true),
    name: z.string().trim().min(2).max(120),
    phone: z.string().trim().min(6).max(20),
    email: z.string().trim().toLowerCase().email().optional(),
    alternate_phone: z.string().trim().max(20).optional(),
    password: z.string().min(6).max(72).optional(),
    role: assignableRole.default('employee'),
    role_ids: z.array(uuid).max(20).default([]),
    salary: money.optional(),
    address: z.string().trim().max(300).optional(),
  })
  .superRefine((v, ctx) => {
    if (!v.create_login) return
    if (!v.email) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['email'], message: 'email is required for a login' })
    }
    if (!v.password) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['password'],
        message: 'password is required for a login',
      })
    }
  })
export type AddMemberRequest = z.infer<typeof addMemberRequest>

/**
 * `temp_password` survives from the pre-wizard flow: null whenever the owner
 * set the password themselves, which is now the normal path.
 */
export const addMemberResponse = z.object({
  user_id: uuid,
  temp_password: z.string().nullable(),
})
export type AddMemberResponse = z.infer<typeof addMemberResponse>

export const updateMemberRequest = z.object({
  status: memberStatus.optional(),
  role: assignableRole.optional(),
  salary: money.nullable().optional(),
  phone: z.string().trim().max(20).nullable().optional(),
  alternate_phone: z.string().trim().max(20).nullable().optional(),
  address: z.string().trim().max(300).nullable().optional(),
})
export type UpdateMemberRequest = z.infer<typeof updateMemberRequest>

/** One row of the pending-invitations panel. */
export const invitation = z.object({
  id: uuid,
  email: z.string(),
  name: z.string(),
  role: z.string(),
  expires_at: isoDateTime,
  created_at: isoDateTime,
  last_sent_at: isoDateTime,
  send_count: z.number().int(),
  expired: z.boolean(),
})
export type Invitation = z.infer<typeof invitation>

export const createInvitationRequest = z.object({
  name: z.string().trim().min(2).max(120),
  email: z.string().trim().toLowerCase().email(),
  role: assignableRole.default('employee'),
  phone: z.string().trim().max(20).optional(),
  alternate_phone: z.string().trim().max(20).optional(),
  engagement_type: engagementType.optional(),
  salary: money.optional(),
  address: z.string().trim().max(300).optional(),
  role_ids: z.array(uuid).max(20).default([]),
})
export type CreateInvitationRequest = z.infer<typeof createInvitationRequest>

/**
 * The link is returned so the owner can pass it on directly — WhatsApp is how
 * this actually reaches most crew, and the email may never be opened.
 */
export const invitationLink = z.object({
  id: uuid,
  invite_link: z.string(),
  expires_at: isoDateTime,
})
export type InvitationLink = z.infer<typeof invitationLink>

/** What the accept screen shows before the invitee commits to a password. */
export const invitationPreview = z.object({
  email: z.string(),
  name: z.string(),
  company_name: z.string(),
  role: z.string(),
  expires_at: isoDateTime,
})
export type InvitationPreview = z.infer<typeof invitationPreview>

export const acceptInvitationRequest = z.object({
  token: z.string().min(10),
  password: z.string().min(6).max(72),
})
export type AcceptInvitationRequest = z.infer<typeof acceptInvitationRequest>
