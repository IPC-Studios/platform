import { afterEach, describe, expect, it, vi } from 'vitest'
import { sendWhatsAppText, whatsappConfigured, whatsappLink } from './whatsapp'

describe('whatsapp', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('is configured only with both halves', () => {
    expect(whatsappConfigured({ WHATSAPP_PHONE_NUMBER_ID: '1', WHATSAPP_ACCESS_TOKEN: '' })).toBe(false)
    expect(whatsappConfigured({ WHATSAPP_PHONE_NUMBER_ID: '1', WHATSAPP_ACCESS_TOKEN: 't' })).toBe(true)
  })

  it('posts a text message to the phone number id and returns the message id', async () => {
    const fetchMock = vi.fn(async (url: string, init: RequestInit) => {
      expect(url).toBe('https://graph.facebook.com/v21.0/123/messages')
      expect(init.headers).toMatchObject({ Authorization: 'Bearer tok' })
      const body = JSON.parse(String(init.body)) as { to: string; text: { body: string }; type: string }
      expect(body).toMatchObject({ to: '919876543210', type: 'text', text: { body: 'Hi Priya' } })
      return new Response(JSON.stringify({ messages: [{ id: 'wamid.1' }] }), { status: 200 })
    })
    vi.stubGlobal('fetch', fetchMock)
    const r = await sendWhatsAppText({ WHATSAPP_PHONE_NUMBER_ID: '123', WHATSAPP_ACCESS_TOKEN: 'tok' }, '919876543210', 'Hi Priya')
    expect(r.message_id).toBe('wamid.1')
  })

  it('throws on a provider refusal so attempt() logs it', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{"error":"bad token"}', { status: 401 })))
    await expect(sendWhatsAppText({ WHATSAPP_PHONE_NUMBER_ID: '1', WHATSAPP_ACCESS_TOKEN: 't' }, '9', 'x')).rejects.toThrow(/401/)
  })

  it('builds the wa.me fallback link', () => {
    expect(whatsappLink('919876543210', 'Hi & bye')).toBe('https://wa.me/919876543210?text=Hi%20%26%20bye')
  })
})
