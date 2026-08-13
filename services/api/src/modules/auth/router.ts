import { Hono } from 'hono'
import {
  registerRequest,
  registerResult,
  loginRequest,
  verifyEmailRequest,
  resendVerificationRequest,
  forgotPasswordRequest,
  forgotPasswordResult,
  resetPasswordRequest,
  authToken,
  sessionState,
} from '@ipc/contracts'
import { serializeAccess } from '@ipc/permissions'
import type { AppEnv } from '../../context'
import { requireAuth } from '../../middleware/auth'
import { fail } from '../../middleware/errors'
import { withService } from '../../lib/db'
import { issueToken, hashPassword, verifyPassword } from '../../lib/auth-token'
import { sendVerificationEmail, sendPasswordResetEmail } from '../../lib/email'

const verifyLink = (env: AppEnv['Bindings'], raw: string) => `${env.APP_URL}/verify?token=${raw}`
const resetLink = (env: AppEnv['Bindings'], raw: string) => `${env.APP_URL}/reset-password?token=${raw}`

/**
 * Auth router (self-issued, no GoTrue). Register creates the auth user + studio
 * and emails a verification link; sign-in is refused until the email is verified.
 */
export const authRouter = new Hono<AppEnv>()
  .post('/register', async (c) => {
    const parsed = registerRequest.safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success) fail(422, 'Please check the form and try again.')
    const { email, password, company_name, admin_name, phone } = parsed.data

    const pwHash = await hashPassword(password)

    let token: string
    try {
      // One transaction: create the auth user, bootstrap the studio, mint a
      // verification token. Rolls back together on any failure.
      token = await withService(c.env, async (sql) => {
        const [u] = await sql<{ id: string }[]>`
          insert into auth.users (email, encrypted_password)
          values (${email}, ${pwHash})
          returning id`
        await sql`select set_config('request.jwt.claim.sub', ${u!.id}, true)`
        await sql`select register_company_and_admin(${company_name}, ${admin_name}, ${phone ?? null})`
        const [t] = await sql<{ token: string }[]>`select issue_email_verification(${u!.id}) as token`
        return t!.token
      })
    } catch (e) {
      if (e && typeof e === 'object' && 'code' in e && (e as { code: string }).code === '23505') {
        fail(409, 'An account with this email already exists.')
      }
      fail(409, 'We could not create your studio. Please try again.')
    }

    await sendVerificationEmail(c.env, email, verifyLink(c.env, token!))

    return c.json(
      registerResult.parse({
        verification_required: true,
        email,
        // Expose the token off-production so automated tests can verify.
        ...(c.env.ENVIRONMENT !== 'production' ? { verification_token: token! } : {}),
      }),
    )
  })

  .post('/verify', async (c) => {
    const parsed = verifyEmailRequest.safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success) fail(422, 'Invalid verification link.')

    const uid = await withService(c.env, async (sql) => {
      const [r] = await sql<{ uid: string | null }[]>`
        select consume_email_verification(${parsed.data.token}) as uid`
      return r?.uid ?? null
    })
    if (!uid) fail(400, 'This verification link is invalid or has expired.')

    // Verified → sign them straight in.
    const token = await issueToken(c.env, uid)
    return c.json(authToken.parse({ access_token: token, token_type: 'bearer' }))
  })

  .post('/resend-verification', async (c) => {
    const parsed = resendVerificationRequest.safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success) fail(422, 'Please enter your email.')

    const raw = await withService(c.env, async (sql) => {
      const [u] = await sql<{ id: string; email_verified: boolean }[]>`
        select id, email_verified from auth.users where email = ${parsed.data.email}`
      if (!u || u.email_verified) return null
      const [t] = await sql<{ token: string }[]>`select issue_email_verification(${u.id}) as token`
      return t!.token
    })
    if (raw) await sendVerificationEmail(c.env, parsed.data.email, verifyLink(c.env, raw))
    // Always 200 — never leak whether an account exists.
    return c.json({ ok: true })
  })

  .post('/login', async (c) => {
    const parsed = loginRequest.safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success) fail(422, 'Please enter your email and password.')
    const { email, password } = parsed.data

    const [row] = await withService(
      c.env,
      (sql) =>
        sql<{ id: string; encrypted_password: string | null; email_verified: boolean }[]>`
          select id, encrypted_password, email_verified from auth.users where email = ${email}`,
    )
    if (!row?.encrypted_password || !(await verifyPassword(password, row.encrypted_password))) {
      fail(401, 'Invalid email or password.')
    }
    if (!row.email_verified) {
      fail(403, 'Please verify your email before signing in. Check your inbox for the link.')
    }

    const token = await issueToken(c.env, row.id)
    return c.json(authToken.parse({ access_token: token, token_type: 'bearer' }))
  })

  .post('/forgot-password', async (c) => {
    const parsed = forgotPasswordRequest.safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success) fail(422, 'Please enter your email.')

    const raw = await withService(c.env, async (sql) => {
      const [u] = await sql<{ id: string }[]>`
        select id from auth.users where email = ${parsed.data.email}`
      if (!u) return null
      const [t] = await sql<{ token: string }[]>`select issue_password_reset(${u.id}) as token`
      return t!.token
    })
    if (raw) await sendPasswordResetEmail(c.env, parsed.data.email, resetLink(c.env, raw))

    // Always 200 — never leak whether an account exists.
    return c.json(
      forgotPasswordResult.parse({
        ok: true,
        // Expose the token off-production so automated tests can reset.
        ...(raw && c.env.ENVIRONMENT !== 'production' ? { reset_token: raw } : {}),
      }),
    )
  })

  .post('/reset-password', async (c) => {
    const parsed = resetPasswordRequest.safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success) fail(422, 'Please choose a password of at least 8 characters.')

    // Hash first (Bun-side argon2id), then swap it in as the token is consumed —
    // one transaction, so a half-done reset can't leave the account unusable.
    const pwHash = await hashPassword(parsed.data.password)
    const uid = await withService(c.env, async (sql) => {
      const [r] = await sql<{ uid: string | null }[]>`
        select consume_password_reset(${parsed.data.token}, ${pwHash}) as uid`
      return r?.uid ?? null
    })
    if (!uid) fail(400, 'This reset link is invalid or has expired. Please request a new one.')

    // Reset proves mailbox control → sign them straight in. Sessions issued
    // before this moment are refused by requireAuth (password_changed_at).
    const token = await issueToken(c.env, uid)
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
