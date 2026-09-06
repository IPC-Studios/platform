import type { Env } from '../context'

/**
 * Mailbox sync (Gmail or Microsoft 365). Given a bearer token for the studio
 * mailbox, pulls recent messages and hands back a provider-neutral shape the
 * activities router matches to contacts by address. Idempotent by the
 * provider's message id.
 *
 * Fails closed: with no provider or token configured, the sync reports
 * `not_configured` and imports nothing. Obtaining and refreshing the token
 * (OAuth consent) is a deployment concern; see docs/RUNBOOK.md.
 */
export type EmailProvider = 'gmail' | 'o365'

type SyncEnv = Pick<Env, 'EMAIL_SYNC_PROVIDER' | 'EMAIL_SYNC_TOKEN' | 'EMAIL_SYNC_MAILBOX'>

export interface SyncedMessage {
  external_id: string
  direction: 'in' | 'out'
  subject: string
  snippet: string
  /** The other party's address, lower-cased. */
  counterpart: string
  at: string
}

export const emailProvider = (env: SyncEnv): EmailProvider | null =>
  env.EMAIL_SYNC_PROVIDER === 'gmail' || env.EMAIL_SYNC_PROVIDER === 'o365' ? env.EMAIL_SYNC_PROVIDER : null

export const emailSyncConfigured = (env: SyncEnv): boolean =>
  emailProvider(env) !== null && !!env.EMAIL_SYNC_TOKEN && !!env.EMAIL_SYNC_MAILBOX

const addr = (v: string): string => {
  const m = /<([^>]+)>/.exec(v)
  return (m ? m[1]! : v).trim().toLowerCase()
}

async function getJson<T>(url: string, token: string): Promise<T> {
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } })
  if (!res.ok) {
    const detail = await res.text().catch(() => '')
    throw new Error(`email sync failed ${res.status}: ${detail.slice(0, 200)}`)
  }
  return (await res.json()) as T
}

interface GmailHeader {
  name: string
  value: string
}
interface GmailMessage {
  id: string
  snippet?: string
  internalDate?: string
  payload?: { headers?: GmailHeader[] }
}

async function fetchGmail(env: SyncEnv, sinceDays: number, max: number): Promise<SyncedMessage[]> {
  const token = env.EMAIL_SYNC_TOKEN
  const mailbox = env.EMAIL_SYNC_MAILBOX.toLowerCase()
  const list = await getJson<{ messages?: Array<{ id: string }> }>(
    `https://gmail.googleapis.com/gmail/v1/users/me/messages?q=${encodeURIComponent(`newer_than:${sinceDays}d`)}&maxResults=${max}`,
    token,
  )
  const out: SyncedMessage[] = []
  for (const m of list.messages ?? []) {
    const full = await getJson<GmailMessage>(
      `https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(m.id)}?format=metadata&metadataHeaders=From&metadataHeaders=To&metadataHeaders=Subject`,
      token,
    )
    const h = (name: string) => full.payload?.headers?.find((x) => x.name.toLowerCase() === name)?.value ?? ''
    const from = addr(h('from'))
    const to = addr(h('to'))
    const outbound = from === mailbox
    out.push({
      external_id: full.id,
      direction: outbound ? 'out' : 'in',
      subject: h('subject'),
      snippet: full.snippet ?? '',
      counterpart: outbound ? to : from,
      at: new Date(Number(full.internalDate ?? Date.now())).toISOString(),
    })
  }
  return out
}

interface GraphMessage {
  id: string
  subject?: string
  bodyPreview?: string
  receivedDateTime?: string
  sentDateTime?: string
  from?: { emailAddress?: { address?: string } }
  toRecipients?: Array<{ emailAddress?: { address?: string } }>
}

async function fetchO365(env: SyncEnv, sinceDays: number, max: number): Promise<SyncedMessage[]> {
  const mailbox = env.EMAIL_SYNC_MAILBOX.toLowerCase()
  const since = new Date(Date.now() - sinceDays * 86_400_000).toISOString()
  const list = await getJson<{ value?: GraphMessage[] }>(
    `https://graph.microsoft.com/v1.0/me/messages?$top=${max}&$orderby=receivedDateTime desc&$filter=${encodeURIComponent(`receivedDateTime ge ${since}`)}&$select=id,subject,bodyPreview,receivedDateTime,sentDateTime,from,toRecipients`,
    env.EMAIL_SYNC_TOKEN,
  )
  return (list.value ?? []).map((m) => {
    const from = (m.from?.emailAddress?.address ?? '').toLowerCase()
    const to = (m.toRecipients?.[0]?.emailAddress?.address ?? '').toLowerCase()
    const outbound = from === mailbox
    return {
      external_id: m.id,
      direction: outbound ? 'out' : 'in',
      subject: m.subject ?? '',
      snippet: m.bodyPreview ?? '',
      counterpart: outbound ? to : from,
      at: new Date(m.sentDateTime ?? m.receivedDateTime ?? Date.now()).toISOString(),
    }
  })
}

/** Recent messages from the configured mailbox. Throws on a provider refusal. */
export async function fetchRecentMessages(env: SyncEnv, opts: { sinceDays?: number; max?: number } = {}): Promise<SyncedMessage[]> {
  const provider = emailProvider(env)
  if (!provider || !emailSyncConfigured(env)) return []
  const sinceDays = Math.min(Math.max(opts.sinceDays ?? 7, 1), 90)
  const max = Math.min(Math.max(opts.max ?? 100, 1), 500)
  return provider === 'gmail' ? fetchGmail(env, sinceDays, max) : fetchO365(env, sinceDays, max)
}
