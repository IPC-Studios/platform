import { Hono } from 'hono'
import type { TransactionSql } from 'postgres'
import {
  registerRequest,
  registerResult,
  loginRequest,
  verifyEmailRequest,
  resendVerificationRequest,
  forgotPasswordRequest,
  forgotPasswordResult,
  resetPasswordRequest,
  refreshRequest,
  logoutRequest,
  authToken,
  sessionState,
  type AuthToken,
} from '@ipc/contracts'
import { serializeAccess } from '@ipc/permissions'
import type { AppEnv } from '../../context'
import { requireAuth } from '../../middleware/auth'
import { fail } from '../../middleware/errors'
import { withService } from '../../lib/db'
import { issueToken, hashPassword, verifyPassword, TTL_SECONDS } from '../../lib/auth-token'
import { sendVerificationEmail, sendPasswordResetEmail } from '../../lib/email'

/** The version stamped into a freshly minted token (see issueToken). */
async function passwordVersion(sql: TransactionSql, uid: string): Promise<number> {
  const [r] = await sql<{ password_version: number }[]>`
    select password_version from auth.users where id = ${uid}`
  return r?.password_version ?? 0
}

/**
 * The one place a session is minted. Every sign-in path (login, verify, reset)
 * returns this pair: a short access token stamped with the caller's current
 * password_version, and a fresh refresh-token family.
 */
async function signIn(env: AppEnv['Bindings'], uid: string): Promise<AuthToken> {
  const { pwv, refresh } = await withService(env, async (sql) => {
    const pwv = await passwordVersion(sql, uid)
    const [r] = await sql<{ token: string }[]>`select issue_refresh_token(${uid}) as token`
    return { pwv, refresh: r!.token }
  })
  return authToken.parse({
    access_token: await issueToken(env, uid, pwv),
    refresh_token: refresh,
    token_type: 'bearer',
    expires_in: TTL_SECONDS,
  })
}

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
    return c.json(await signIn(c.env, uid))
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

    return c.json(await signIn(c.env, row.id))
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
      // Refresh tokens are revoked here, not in SQL: the reset RPC predates
      // them and stays focused on the password.
      if (r?.uid) await sql`select revoke_all_sessions(${r.uid})`
      return r?.uid ?? null
    })
    if (!uid) fail(400, 'This reset link is invalid or has expired. Please request a new one.')

    // Reset proves mailbox control → sign them straight in. Every session issued
    // before it now carries a stale password_version and is refused.
    return c.json(await signIn(c.env, uid))
  })

  .post('/refresh', async (c) => {
    const parsed = refreshRequest.safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success) fail(422, 'Missing refresh token.')

    const rotated = await withService(c.env, async (sql) => {
      const [r] = await sql<{ user_id: string | null; token: string | null }[]>`
        select * from rotate_refresh_token(${parsed.data.refresh_token})`
      if (!r?.user_id || !r.token) return null
      return { uid: r.user_id, refresh: r.token, pwv: await passwordVersion(sql, r.user_id) }
    })
    if (!rotated) fail(401, 'Your session has expired. Please sign in again.')

    return c.json(
      authToken.parse({
        access_token: await issueToken(c.env, rotated.uid, rotated.pwv),
        refresh_token: rotated.refresh,
        token_type: 'bearer',
        expires_in: TTL_SECONDS,
      }),
    )
  })

  .post('/logout', async (c) => {
    const parsed = logoutRequest.safeParse(await c.req.json().catch(() => ({})))
    // Sign-out never fails: the client has already dropped its tokens.
    if (parsed.success && parsed.data.refresh_token) {
      await withService(
        c.env,
        (sql) => sql`select revoke_refresh_family(${parsed.data.refresh_token!})`,
      ).catch(() => null)
    }
    return c.json({ ok: true })
  })

  // Sign out everywhere, this device included: revokes every refresh family and
  // bumps password_version, which strands the access tokens already out there.
  .post('/logout-all', requireAuth, async (c) => {
    const uid = c.get('auth').userId
    await withService(c.env, (sql) => sql`select revoke_all_sessions(${uid})`).catch(() => null)
    return c.json({ ok: true })
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
