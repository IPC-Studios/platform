import type { Env } from '../context'
import { timingSafeEqual, toHex } from './crypto'

/**
 * Meta (Facebook/Instagram) lead ads.
 *
 * Meta does not post the lead itself. It posts a notification carrying a
 * `leadgen_id`; the lead's fields are then fetched from the Graph API with a
 * page access token. Every post is signed with the app secret.
 */
const GRAPH = 'https://graph.facebook.com/v21.0'

/** X-Hub-Signature-256: "sha256=<hex hmac of the raw body>". */
export async function verifyMetaSignature(raw: string, header: string, appSecret: string): Promise<boolean> {
  if (!appSecret || !header) return false
  const given = header.startsWith('sha256=') ? header.slice(7) : header
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(appSecret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const mac = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(raw))
  return timingSafeEqual(toHex(mac), given.toLowerCase())
}

interface MetaChange {
  field?: string
  value?: { leadgen_id?: string; form_id?: string; page_id?: string; ad_id?: string; created_time?: number }
}
interface MetaEntry {
  id?: string
  changes?: MetaChange[]
}
export interface MetaLeadgenPayload {
  object: 'page'
  entry: MetaEntry[]
}

/** Whether a webhook body is Meta's leadgen notification shape. */
export function isMetaLeadgenPayload(body: unknown): body is MetaLeadgenPayload {
  if (!body || typeof body !== 'object') return false
  const b = body as { object?: unknown; entry?: unknown }
  return b.object === 'page' && Array.isArray(b.entry)
}

/** Every leadgen id in the notification, with what Meta said about it. */
export function metaLeadgenIds(payload: MetaLeadgenPayload): Array<{ leadgen_id: string; meta: Record<string, unknown> }> {
  const out: Array<{ leadgen_id: string; meta: Record<string, unknown> }> = []
  for (const entry of payload.entry) {
    for (const change of entry.changes ?? []) {
      const id = change.value?.leadgen_id
      if (change.field === 'leadgen' && id) {
        out.push({
          leadgen_id: id,
          meta: {
            leadgen_id: id,
            form_id: change.value?.form_id ?? null,
            page_id: change.value?.page_id ?? entry.id ?? null,
            ad_id: change.value?.ad_id ?? null,
            created_time: change.value?.created_time ?? null,
          },
        })
      }
    }
  }
  return out
}

export interface MetaLead {
  name: string | null
  phone: string | null
  email: string | null
  fields: Record<string, string>
}

interface GraphLead {
  id?: string
  created_time?: string
  field_data?: Array<{ name?: string; values?: string[] }>
}

/** Map Graph API field_data to the lead we store. Unknown fields are kept in `fields`. */
export function mapGraphLead(lead: GraphLead): MetaLead {
  const fields: Record<string, string> = {}
  for (const f of lead.field_data ?? []) {
    if (f.name && f.values && f.values.length > 0) fields[f.name] = f.values.join(', ')
  }
  const pick = (...keys: string[]) => {
    for (const k of keys) if (fields[k]) return fields[k]!
    return null
  }
  return {
    name: pick('full_name', 'name', 'first_name') && [fields.full_name ?? fields.name ?? fields.first_name, fields.last_name].filter(Boolean).join(' ').trim(),
    phone: pick('phone_number', 'phone', 'mobile', 'whatsapp_number'),
    email: pick('email', 'email_address'),
    fields,
  }
}

/** Fetch one lead's fields. Throws on any non-2xx so attempt() logs it. */
export async function fetchMetaLead(env: Pick<Env, 'META_PAGE_ACCESS_TOKEN'>, leadgenId: string): Promise<MetaLead> {
  const url = `${GRAPH}/${encodeURIComponent(leadgenId)}?fields=id,created_time,field_data&access_token=${encodeURIComponent(env.META_PAGE_ACCESS_TOKEN)}`
  const res = await fetch(url)
  if (!res.ok) {
    const detail = await res.text().catch(() => '')
    throw new Error(`meta lead fetch failed ${res.status}: ${detail.slice(0, 200)}`)
  }
  return mapGraphLead((await res.json()) as GraphLead)
}
