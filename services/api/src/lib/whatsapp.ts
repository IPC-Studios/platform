import type { Env } from '../context'

/**
 * WhatsApp Cloud API (Meta). With a phone number id and access token
 * configured, the API sends the message itself and the lead's history says
 * "sent"; without them the client opens wa.me with the text filled in, which
 * is the same message typed by a person.
 *
 * Text messages only. Template messages need Meta-approved templates and a
 * different payload; that is a later step.
 */
const GRAPH = 'https://graph.facebook.com/v21.0'

export const whatsappConfigured = (env: Pick<Env, 'WHATSAPP_PHONE_NUMBER_ID' | 'WHATSAPP_ACCESS_TOKEN'>): boolean =>
  !!env.WHATSAPP_PHONE_NUMBER_ID && !!env.WHATSAPP_ACCESS_TOKEN

/** `to` is the normalised number (digits, country code first). Throws on non-2xx. */
export async function sendWhatsAppText(
  env: Pick<Env, 'WHATSAPP_PHONE_NUMBER_ID' | 'WHATSAPP_ACCESS_TOKEN'>,
  to: string,
  body: string,
): Promise<{ message_id: string }> {
  const res = await fetch(`${GRAPH}/${encodeURIComponent(env.WHATSAPP_PHONE_NUMBER_ID)}/messages`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.WHATSAPP_ACCESS_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to,
      type: 'text',
      text: { preview_url: false, body },
    }),
  })
  if (!res.ok) {
    const detail = await res.text().catch(() => '')
    throw new Error(`whatsapp send failed ${res.status}: ${detail.slice(0, 200)}`)
  }
  const json = (await res.json()) as { messages?: Array<{ id?: string }> }
  return { message_id: json.messages?.[0]?.id ?? '' }
}

/** The wa.me link that opens the chat with the message filled in. */
export const whatsappLink = (to: string, body: string): string =>
  `https://wa.me/${to}?text=${encodeURIComponent(body)}`
