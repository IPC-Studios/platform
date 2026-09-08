import { Hono, type Context } from 'hono'
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
  changePasswordRequest,
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
import { attempt } from '../../lib/attempt'
import { audit } from '../../lib/audit'
import { isDevLike } from '../../lib/env'
import { issueToken, hashPassword, verifyPassword, TTL_SECONDS } from '../../lib/auth-token'
import { clearRefreshCookie, cookieMode, readRefreshCookie, setRefreshCookie } from '../../lib/session-cookie'
import { originAllowed } from '../../lib/allowed-origins'
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
async function signIn(c: Context<AppEnv>, uid: string): Promise<AuthToken> {
  const env = c.env
  const { pwv, refresh } = await withService(env, async (sql) => {
    const pwv = await passwordVersion(sql, uid)
    const [r] = await sql<{ token: string }[]>`select issue_refresh_token(${uid}) as token`
    return { pwv, refresh: r!.token }
  })
  return pair(c, await issueToken(env, uid, pwv), refresh)
}

/**
 * The wire shape of a session. In cookie mode the refresh token goes into the
 * HttpOnly cookie and the body carries an empty string in its place, so no
 * script on the page ever sees the 30-day credential.
 */
function pair(c: Context<AppEnv>, accessToken: string, refresh: string): AuthToken {
  const viaCookie = cookieMode(c.env)
  if (viaCookie) setRefreshCookie(c, refresh)
  return authToken.parse({
    access_token: accessToken,
    refresh_token: viaCookie ? '' : refresh,
    token_type: 'bearer',
    expires_in: TTL_SECONDS,
  })
}

/**
 * Whether it is safe to hand a raw token back in the response body, which the
 * automated suites rely on. Fails CLOSED: an unset or unrecognised ENVIRONMENT
 * withholds the token (see lib/env.ts).
 */
const echoesTokens = isDevLike

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

    // One transaction: create the auth user, bootstrap the studio, mint a
    // verification token. Rolls back together on any failure.
    const token = await attempt(
      c,
      'auth.register',
      () =>
        withService(c.env, async (sql) => {
          const [u] = await sql<{ id: string }[]>`
            insert into auth.users (email, encrypted_password)
            values (${email}, ${pwHash})
            returning id`
          await sql`select set_config('request.jwt.claim.sub', ${u!.id}, true)`
          await sql`select register_company_and_admin(${company_name}, ${admin_name}, ${phone ?? null})`
          const [t] = await sql<{ token: string }[]>`select issue_email_verification(${u!.id}) as token`
          return t!.token
        }),
      { onCode: (code) => (code === '23505' ? 'taken' : undefined) },
    )
    if (token === 'taken') fail(409, 'An account with this email already exists.')
    if (!token) fail(400, 'We could not create your studio. Please try again.')

    await sendVerificationEmail(c.env, email, verifyLink(c.env, token))

    return c.json(
      registerResult.parse({
        verification_required: true,
        email,
        // Expose the token in test environments so automated suites can verify.
        ...(echoesTokens(c.env) ? { verification_token: token } : {}),
      }),
    )
  })

  .post('/verify', async (c) => {
    const parsed = verifyEmailRequest.safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success) fail(422, 'Invalid verification link.')

    const uid = await attempt(c, 'auth.verify', () =>
      withService(c.env, async (sql) => {
        const [r] = await sql<{ uid: string | null }[]>`
          select consume_email_verification(${parsed.data.token}) as uid`
        return r?.uid ?? null
      }),
    )
    if (!uid) fail(400, 'This verification link is invalid or has expired.')

    // Verified → sign them straight in.
    return c.json(await signIn(c, uid))
  })

  .post('/resend-verification', async (c) => {
    const parsed = resendVerificationRequest.safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success) fail(422, 'Please enter your email.')

    const raw = await attempt(c, 'auth.resend_verification', () =>
      withService(c.env, async (sql) => {
        const [u] = await sql<{ id: string; email_verified: boolean }[]>`
          select id, email_verified from auth.users where email = ${parsed.data.email}`
        if (!u || u.email_verified) return null
        const [t] = await sql<{ token: string }[]>`select issue_email_verification(${u.id}) as token`
        return t!.token
      }),
    )
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

    const rows = await attempt(c, 'auth.login', () =>
      withService(
        c.env,
        (sql) =>
          sql<{ id: string; encrypted_password: string | null; email_verified: boolean }[]>`
            select id, encrypted_password, email_verified from auth.users where email = ${email}`,
      ),
    )
    if (!rows) fail(503, 'The service is temporarily unavailable. Please try again in a moment.')
    const row = rows[0]
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

    return c.json(await signIn(c, row.id))
  })

  .post('/google', async (c) => {
    const body = await c.req.json().catch(() => ({}))
    const token = typeof body.id_token === 'string' ? body.id_token.trim() : ''
    if (!token) fail(422, 'Missing Google token.')
    if (!c.env.GOOGLE_CLIENT_ID) fail(503, 'Google login is not configured on this server.')

    // Verify via Google tokeninfo (no secret needed for GIS id_token)
    let info: Record<string, string>
    try {
      const res = await fetch(`https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(token)}`)
      if (!res.ok) fail(401, 'Invalid Google token. Please try again.')
      info = (await res.json()) as Record<string, string>
    } catch {
      fail(401, 'Could not verify Google token. Please try again.')
    }
    if (info.aud !== c.env.GOOGLE_CLIENT_ID) fail(401, 'Google token audience mismatch.')
    if (info.iss !== 'https://accounts.google.com' && info.iss !== 'accounts.google.com') {
      fail(401, 'Invalid Google token issuer.')
    }
    if (info.email_verified !== 'true') fail(401, 'Your Google email is not verified.')
    const email = (info.email ?? '').toLowerCase().trim()
    if (!email) fail(401, 'No email in Google token.')

    const rows = await attempt(c, 'auth.google.lookup', () =>
      withService(c.env, (sql) => sql<{ id: string; email_verified: boolean }[]>`select id, email_verified from auth.users where lower(email) = ${email}`),
    )
    if (!rows) fail(503, 'The service is temporarily unavailable. Please try again in a moment.')
    const row = rows[0]
    if (!row) fail(404, 'No studio account found for this Google email. Please register first or use email + password.')

    // Google proves mailbox control: auto-verify if still pending
    if (!row.email_verified) {
      await attempt(c, 'auth.google.verify', () =>
        withService(c.env, (sql) => sql`update auth.users set email_verified = true where id = ${row.id}`),
      )
    }

    return c.json(await signIn(c, row.id))
  })

  .post('/forgot-password', async (c) => {
    const parsed = forgotPasswordRequest.safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success) fail(422, 'Please enter your email.')

    const raw = await attempt(c, 'auth.forgot_password', () =>
      withService(c.env, async (sql) => {
        const [u] = await sql<{ id: string }[]>`
          select id from auth.users where email = ${parsed.data.email}`
        if (!u) return null
        const [t] = await sql<{ token: string }[]>`select issue_password_reset(${u.id}) as token`
        return t!.token
      }),
    )
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
    const uid = await attempt(c, 'auth.reset_password', () =>
      withService(c.env, async (sql) => {
        const [r] = await sql<{ uid: string | null }[]>`
          select consume_password_reset(${parsed.data.token}, ${pwHash}) as uid`
        // Refresh tokens are revoked here, not in SQL: the reset RPC predates
        // them and stays focused on the password.
        if (r?.uid) await sql`select revoke_all_sessions(${r.uid})`
        return r?.uid ?? null
      }),
    )
    if (!uid) fail(400, 'This reset link is invalid or has expired. Please request a new one.')

    // Reset proves mailbox control → sign them straight in. Every session issued
    // before it now carries a stale password_version and is refused.
    return c.json(await signIn(c, uid))
  })

  // Change the password from inside a signed-in session. The current password
  // is the proof; every other device is signed out, and this one gets a fresh
  // pair so it is not stranded by its own version bump.
  .post('/change-password', requireAuth, async (c) => {
    const parsed = changePasswordRequest.safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success) fail(422, 'Use at least 8 characters, and not the current password.')
    const uid = c.get('auth').userId

    const rows = await attempt(c, 'auth.change_password.lookup', () =>
      withService(
        c.env,
        (sql) => sql<{ encrypted_password: string | null }[]>`
          select encrypted_password from auth.users where id = ${uid}`,
      ),
    )
    if (!rows) fail(503, 'The service is temporarily unavailable. Please try again in a moment.')
    const current = rows[0]?.encrypted_password
    const ok = await verifyPassword(parsed.data.current_password, current ?? (await decoyHash()))
    if (!current || !ok) fail(401, 'Your current password is incorrect.')

    const pwHash = await hashPassword(parsed.data.new_password)
    const done = await attempt(c, 'auth.change_password', () =>
      withService(c.env, async (sql) => {
        await sql`
          update auth.users
             set encrypted_password = ${pwHash}, password_changed_at = now()
           where id = ${uid}`
        // Bumps password_version and revokes every refresh family.
        await sql`select revoke_all_sessions(${uid})`
        return true
      }),
    )
    if (!done) fail(400, 'We could not change your password. Please try again.')

    await audit(c, { action: 'account.password_changed', entityType: 'user', entityId: uid })
    return c.json(await signIn(c, uid))
  })

  // ── Invitations ─────────────────────────────────────────────
  // Both halves are public: the invitee has no session until they accept. The
  // token in the link is the only credential, and it is matched against a hash.
  .get('/invite', async (c) => {
    const token = c.req.query('token')
    if (!token) fail(422, 'This invitation link is incomplete.')

    const rows = await attempt(c, 'auth.peek_invite', () =>
      withService(
        c.env,
        (sql) => sql<
          { email: string; name: string; company_name: string; role: string; expires_at: string }[]
        >`select * from peek_user_invitation(${token})`,
      ),
    )
    // A database failure is an outage, not a bad link.
    if (!rows) fail(503, 'The service is temporarily unavailable. Please try again in a moment.')
    const row = rows[0]
    if (!row) fail(404, 'This invitation is invalid, revoked, or has expired.')

    return c.json(invitationPreview.parse(row))
  })

  .post('/accept-invite', async (c) => {
    const parsed = acceptInvitationRequest.safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success) fail(422, 'Please choose a password of at least 6 characters.')

    // Hash first, then consume: the SQL side creates the identity and the tenant
    // row in one transaction, so a failure leaves no half-built member behind.
    const pwHash = await hashPassword(parsed.data.password)
    const uid = await attempt(
      c,
      'auth.accept_invite',
      () =>
        withService(c.env, async (sql) => {
          const [r] = await sql<{ uid: string | null }[]>`
            select consume_user_invitation(${parsed.data.token}, ${pwHash}) as uid`
          return r?.uid ?? null
        }),
      { onCode: (code) => (code === '23505' ? 'taken' : undefined) },
    )
    if (uid === 'taken') fail(409, 'An account with this email already exists. Please sign in instead.')
    if (!uid) fail(400, 'This invitation is invalid, revoked, or has expired.')

    // Following the link proves mailbox control, so acceptance signs them in.
    return c.json(await signIn(c, uid))
  })

  .post('/refresh', async (c) => {
    const parsed = refreshRequest.safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success) fail(422, 'Missing refresh token.')
    // A cookie-presented token arrives without the page's involvement, so a
    // forged cross-site POST must not spend it: browsers always send Origin
    // on POST, and only allowlisted origins may rotate by cookie.
    const fromCookie = parsed.data.refresh_token == null && readRefreshCookie(c) != null
    if (fromCookie && !originAllowed(c.env, c.req.header('origin'))) {
      fail(403, 'Your session has expired. Please sign in again.')
    }
    // Body first (the client that holds one), else the HttpOnly cookie.
    const presented = parsed.data.refresh_token ?? readRefreshCookie(c)
    if (!presented) fail(422, 'Missing refresh token.')

    const rotated = await attempt(c, 'auth.refresh', () =>
      withService(c.env, async (sql) => {
        const [r] = await sql<{ user_id: string | null; token: string | null }[]>`
          select * from rotate_refresh_token(${presented})`
        if (!r?.user_id || !r.token) return 'refused' as const
        return { uid: r.user_id, refresh: r.token, pwv: await passwordVersion(sql, r.user_id) }
      }),
    )
    // An outage must not read as "session over" — the client would drop
    // perfectly good tokens on a blip.
    if (!rotated) fail(503, 'The service is temporarily unavailable. Please try again in a moment.')
    if (rotated === 'refused') {
      if (cookieMode(c.env)) clearRefreshCookie(c)
      fail(401, 'Your session has expired. Please sign in again.')
    }

    return c.json(pair(c, await issueToken(c.env, rotated.uid, rotated.pwv), rotated.refresh))
  })

  .post('/logout', async (c) => {
    const parsed = logoutRequest.safeParse(await c.req.json().catch(() => ({})))
    // Sign-out never fails: the client has already dropped its tokens.
    const raw = (parsed.success ? parsed.data.refresh_token : undefined) ?? readRefreshCookie(c)
    if (raw) {
      await attempt(c, 'auth.logout', () =>
        withService(c.env, (sql) => sql`select revoke_refresh_family(${raw})`),
      )
    }
    if (cookieMode(c.env)) clearRefreshCookie(c)
    return c.json({ ok: true })
  })

  // Sign out everywhere, this device included: revokes every refresh family and
  // bumps password_version, which strands the access tokens already out there.
  .post('/logout-all', requireAuth, async (c) => {
    const uid = c.get('auth').userId
    // Unlike /logout, the server-side revocation IS the feature — a swallowed
    // error here would tell the user every device was signed out when none was.
    const revoked = await attempt(c, 'auth.logout_all', () =>
      withService(c.env, (sql) => sql`select revoke_all_sessions(${uid})`),
    )
    if (!revoked) fail(400, 'We could not sign out your other devices. Please try again.')
    if (cookieMode(c.env)) clearRefreshCookie(c)
    await audit(c, { action: 'account.signed_out_everywhere', entityType: 'user', entityId: uid })
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
