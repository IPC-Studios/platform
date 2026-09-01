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
  acceptInvitationRequest,
  invitationPreview,
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

/**
 * A throwaway hash to verify against when no account matches, so a miss costs
 * the same argon2 work as a hit. Computed once, on first use.
 */
let decoy: string | null = null
async function decoyHash(): Promise<string> {
  decoy ??= await hashPassword(crypto.randomUUID())
  return decoy
}

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

/**
 * Whether it is safe to hand a raw token back in the response body, which the
 * automated suites rely on. Fails CLOSED: an unset or unrecognised ENVIRONMENT
 * withholds the token. The old `!== 'production'` test returned live reset
 * tokens to anonymous callers on any deployment that simply forgot the var.
 */
const TOKEN_ECHO_ENVIRONMENTS = new Set(['development', 'test', 'ci', 'local'])
const echoesTokens = (env: AppEnv['Bindings']) => TOKEN_ECHO_ENVIRONMENTS.has(env.ENVIRONMENT ?? '')

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
        // Expose the token in test environments so automated suites can verify.
        ...(echoesTokens(c.env) ? { verification_token: token! } : {}),
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
    // Dispatched, not awaited: waiting on the mail provider only when the
    // account exists turns the uniform 200 into a timing oracle.
    if (raw) void sendVerificationEmail(c.env, parsed.data.email, verifyLink(c.env, raw))
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
    // Always spend a verification, even for an unknown address: short-circuiting
    // here made a miss answer an order of magnitude faster than a hit, which
    // enumerates the customer base by latency alone.
    const ok = await verifyPassword(password, row?.encrypted_password ?? (await decoyHash()))
    if (!row?.encrypted_password || !ok) {
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
    // Dispatched, not awaited: waiting on the mail provider only when the
    // account exists turns the uniform 200 into a timing oracle.
    if (raw) void sendPasswordResetEmail(c.env, parsed.data.email, resetLink(c.env, raw))

    // Always 200 — never leak whether an account exists.
    return c.json(
      forgotPasswordResult.parse({
        ok: true,
        // Expose the token in test environments so automated suites can reset.
        ...(raw && echoesTokens(c.env) ? { reset_token: raw } : {}),
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

  // ── Invitations ─────────────────────────────────────────────
  // Both halves are public: the invitee has no session until they accept. The
  // token in the link is the only credential, and it is matched against a hash.
  .get('/invite', async (c) => {
    const token = c.req.query('token')
    if (!token) fail(422, 'This invitation link is incomplete.')

    const [row] = await withService(
      c.env,
      (sql) => sql<
        { email: string; name: string; company_name: string; role: string; expires_at: string }[]
      >`select * from peek_user_invitation(${token})`,
    ).catch(() => [])
    if (!row) fail(404, 'This invitation is invalid, revoked, or has expired.')

    return c.json(invitationPreview.parse(row))
  })

  .post('/accept-invite', async (c) => {
    const parsed = acceptInvitationRequest.safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success) fail(422, 'Please choose a password of at least 6 characters.')

    // Hash first, then consume: the SQL side creates the identity and the tenant
    // row in one transaction, so a failure leaves no half-built member behind.
    const pwHash = await hashPassword(parsed.data.password)
    let uid: string | null
    try {
      uid = await withService(c.env, async (sql) => {
        const [r] = await sql<{ uid: string | null }[]>`
          select consume_user_invitation(${parsed.data.token}, ${pwHash}) as uid`
        return r?.uid ?? null
      })
    } catch (e) {
      if (e && typeof e === 'object' && 'code' in e && (e as { code: string }).code === '23505') {
        fail(409, 'An account with this email already exists. Please sign in instead.')
      }
      fail(400, 'We could not accept this invitation. Please ask for a new link.')
    }
    if (!uid!) fail(400, 'This invitation is invalid, revoked, or has expired.')

    // Following the link proves mailbox control, so acceptance signs them in.
    return c.json(await signIn(c.env, uid!))
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
    // Unlike /logout, the server-side revocation IS the feature — a swallowed
    // error here would tell the user every device was signed out when none was.
    const revoked = await withService(
      c.env,
      (sql) => sql`select revoke_all_sessions(${uid})`,
    ).catch(() => null)
    if (!revoked) fail(400, 'We could not sign out your other devices. Please try again.')
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
