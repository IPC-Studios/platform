import type { Env } from '../context'

/**
 * Transactional email via Resend. Non-fatal by design: if it fails (or no key is
 * configured in dev), we log and move on — the studio still exists and the user
 * can request a resend. Never let a mail hiccup fail a request.
 */
async function send(env: Env, to: string, subject: string, html: string): Promise<void> {
  if (!env.RESEND_API_KEY) {
    console.warn(`[email] RESEND_API_KEY unset — skipping "${subject}" to ${to}`)
    return
  }
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ from: env.EMAIL_FROM, to, subject, html }),
    })
    if (!res.ok) {
      console.error(`[email] send failed ${res.status}: ${await res.text().catch(() => '')}`)
    }
  } catch (e) {
    console.error('[email] send threw', e)
  }
}

export function sendVerificationEmail(env: Env, to: string, link: string): Promise<void> {
  return send(
    env,
    to,
    'Verify your IPC Studios email',
    `<p>Welcome to IPC Studios. Confirm your email to activate your studio:</p>
     <p><a href="${link}">Verify email</a></p>
     <p>Or paste this link into your browser:<br>${link}</p>
     <p>This link expires in 24 hours.</p>`,
  )
}
