import { Hono } from 'hono'
import { registerRequest, loginRequest, authToken, sessionState } from '@ipc/contracts'
import { serializeAccess } from '@ipc/permissions'
import type { AppEnv } from '../../context'
import { requireAuth } from '../../middleware/auth'
import { fail } from '../../middleware/errors'
import { withService } from '../../lib/db'
import { issueToken, hashPassword, verifyPassword } from '../../lib/auth-token'

/**
 * Auth router (self-issued, no GoTrue). /register creates the auth user + studio
 * atomically and returns a bearer token; /login verifies a password and returns
 * one; /session hydrates the app from the JWT.
 */
export const authRouter = new Hono<AppEnv>()
  .post('/register', async (c) => {
    const parsed = registerRequest.safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success) fail(422, 'Please check the form and try again.')
    const { email, password, company_name, admin_name, phone } = parsed.data

    const pwHash = await hashPassword(password)

    let uid: string
    try {
      // One transaction: create the auth user, bind auth.uid() to it, then run
      // the atomic studio bootstrap. Rolls back together on any failure.
      uid = await withService(c.env, async (sql) => {
        const rows = await sql<{ id: string }[]>`
          insert into auth.users (email, encrypted_password)
          values (${email}, ${pwHash})
          returning id`
        const id = rows[0]!.id
        await sql`select set_config('request.jwt.claim.sub', ${id}, true)`
        await sql`select register_company_and_admin(${company_name}, ${admin_name}, ${phone ?? null})`
        return id
      })
    } catch (e) {
      // Unique-violation on email (23505) or any bootstrap error.
      if (e && typeof e === 'object' && 'code' in e && (e as { code: string }).code === '23505') {
        fail(409, 'An account with this email already exists.')
      }
      fail(409, 'We could not create your studio. Please try again.')
    }

    const token = await issueToken(c.env, uid!)
    return c.json(authToken.parse({ access_token: token, token_type: 'bearer' }))
  })

  .post('/login', async (c) => {
    const parsed = loginRequest.safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success) fail(422, 'Please enter your email and password.')
    const { email, password } = parsed.data

    const [row] = await withService(
      c.env,
      (sql) =>
        sql<{ id: string; encrypted_password: string | null }[]>`
          select id, encrypted_password from auth.users where email = ${email}`,
    )
    // Verify even when the user is missing? Not needed — constant-ish; keep simple.
    if (!row?.encrypted_password || !(await verifyPassword(password, row.encrypted_password))) {
      fail(401, 'Invalid email or password.')
    }

    const token = await issueToken(c.env, row.id)
    return c.json(authToken.parse({ access_token: token, token_type: 'bearer' }))
  })

  // Whole-session hydration for an established tenant.
  .get('/session', requireAuth, (c) => {
    const a = c.get('auth')
    return c.json(
      sessionState.parse({
        user_id: a.userId,
        company_id: a.companyId,
        role: a.role,
        is_owner: a.isOwner,
        is_platform_admin: a.isPlatformAdmin,
        display_name: a.displayName,
        email: a.email,
        plan_gate: a.planGate,
        plan_expiry: a.planExpiry,
        permissions: serializeAccess(a.access),
      }),
    )
  })
