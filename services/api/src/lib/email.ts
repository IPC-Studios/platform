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
  return send(env, to, 'Verify your IPC Studios email', verificationHtml(link))
}

/** Branded, email-client-safe HTML (table layout + inline styles). */
function verificationHtml(link: string): string {
  const brand = '#4f46e5'
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="color-scheme" content="light" />
    <title>Verify your email</title>
  </head>
  <body style="margin:0;padding:0;background:#f3f4f6;">
    <!-- preheader (hidden) -->
    <div style="display:none;max-height:0;overflow:hidden;opacity:0;">
      Confirm your email to activate your IPC Studios workspace.
    </div>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f3f4f6;padding:32px 12px;">
      <tr>
        <td align="center">
          <table role="presentation" width="480" cellpadding="0" cellspacing="0"
                 style="max-width:480px;width:100%;background:#ffffff;border:1px solid #e5e7eb;border-radius:14px;overflow:hidden;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
            <!-- header -->
            <tr>
              <td align="center" style="padding:32px 32px 8px;">
                <table role="presentation" cellpadding="0" cellspacing="0">
                  <tr>
                    <td style="width:44px;height:44px;background:${brand};border-radius:12px;text-align:center;vertical-align:middle;font-size:22px;line-height:44px;">📷</td>
                  </tr>
                </table>
                <div style="margin-top:12px;font-size:18px;font-weight:600;color:#111827;letter-spacing:-0.01em;">IPC Studios</div>
              </td>
            </tr>
            <!-- body -->
            <tr>
              <td style="padding:8px 32px 4px;">
                <h1 style="margin:16px 0 8px;font-size:20px;font-weight:600;color:#111827;text-align:center;">Verify your email</h1>
                <p style="margin:0 0 24px;font-size:14px;line-height:1.6;color:#4b5563;text-align:center;">
                  Welcome! Confirm your email address to activate your studio workspace.
                </p>
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                  <tr>
                    <td align="center" style="padding:4px 0 8px;">
                      <a href="${link}"
                         style="display:inline-block;background:${brand};color:#ffffff;text-decoration:none;font-size:14px;font-weight:600;padding:12px 28px;border-radius:10px;">
                        Verify email
                      </a>
                    </td>
                  </tr>
                </table>
                <p style="margin:20px 0 6px;font-size:12px;color:#6b7280;text-align:center;">Or paste this link into your browser:</p>
                <p style="margin:0 0 8px;font-size:12px;text-align:center;word-break:break-all;">
                  <a href="${link}" style="color:${brand};text-decoration:none;">${link}</a>
                </p>
              </td>
            </tr>
            <!-- footer -->
            <tr>
              <td style="padding:20px 32px 28px;border-top:1px solid #f3f4f6;">
                <p style="margin:12px 0 0;font-size:12px;color:#9ca3af;text-align:center;">
                  This link expires in 24 hours. If you didn't create an account, you can ignore this email.
                </p>
              </td>
            </tr>
          </table>
          <div style="margin-top:16px;font-size:11px;color:#9ca3af;">© IPC Studios</div>
        </td>
      </tr>
    </table>
  </body>
</html>`
}
