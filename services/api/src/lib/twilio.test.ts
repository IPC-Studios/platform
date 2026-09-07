import { afterEach, describe, expect, it, vi } from 'vitest'
import { e164, placeCall, twilioConfigured } from './twilio'

const env = { TWILIO_ACCOUNT_SID: 'AC123', TWILIO_AUTH_TOKEN: 'tok', TWILIO_FROM_NUMBER: '+911234567890' }

describe('twilio', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('is configured only with all three values', () => {
    expect(twilioConfigured({ ...env, TWILIO_FROM_NUMBER: '' })).toBe(false)
    expect(twilioConfigured(env)).toBe(true)
  })

  it('formats E.164 from a normalised number', () => {
    expect(e164('919876543210')).toBe('+919876543210')
    expect(e164('+919876543210')).toBe('+919876543210')
  })

  it('rings the agent and dials the lead, authenticated with the account', async () => {
    const fetchMock = vi.fn(async (url: string, init: RequestInit) => {
      expect(url).toBe('https://api.twilio.com/2010-04-01/Accounts/AC123/Calls.json')
      expect((init.headers as Record<string, string>).Authorization).toBe(`Basic ${btoa('AC123:tok')}`)
      const form = new URLSearchParams(String(init.body))
      expect(form.get('To')).toBe('+919999999999')
      expect(form.get('From')).toBe('+911234567890')
      expect(form.get('Twiml')).toContain('<Dial callerId="+911234567890">+919876543210</Dial>')
      return new Response(JSON.stringify({ sid: 'CA1', status: 'queued' }), { status: 201 })
    })
    vi.stubGlobal('fetch', fetchMock)
    const r = await placeCall(env, '919999999999', '919876543210')
    expect(r).toEqual({ sid: 'CA1', status: 'queued' })
  })

  it('throws on a provider refusal', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{"message":"nope"}', { status: 401 })))
    await expect(placeCall(env, '1', '2')).rejects.toThrow(/401/)
  })
})
