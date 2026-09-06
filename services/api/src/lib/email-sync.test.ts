import { afterEach, describe, expect, it, vi } from 'vitest'
import { emailSyncConfigured, fetchRecentMessages } from './email-sync'

describe('email sync', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('is off without a provider, token and mailbox', () => {
    expect(emailSyncConfigured({ EMAIL_SYNC_PROVIDER: '', EMAIL_SYNC_TOKEN: 't', EMAIL_SYNC_MAILBOX: 'a@b.in' })).toBe(false)
    expect(emailSyncConfigured({ EMAIL_SYNC_PROVIDER: 'gmail', EMAIL_SYNC_TOKEN: '', EMAIL_SYNC_MAILBOX: 'a@b.in' })).toBe(false)
    expect(emailSyncConfigured({ EMAIL_SYNC_PROVIDER: 'o365', EMAIL_SYNC_TOKEN: 't', EMAIL_SYNC_MAILBOX: 'a@b.in' })).toBe(true)
  })

  it('imports nothing when unconfigured, without touching the network', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    expect(await fetchRecentMessages({ EMAIL_SYNC_PROVIDER: '', EMAIL_SYNC_TOKEN: '', EMAIL_SYNC_MAILBOX: '' })).toEqual([])
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('normalises Gmail messages, telling inbound from outbound by the mailbox', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes('/messages?')) return new Response(JSON.stringify({ messages: [{ id: 'm1' }, { id: 'm2' }] }))
      if (url.includes('/messages/m1')) {
        return new Response(
          JSON.stringify({
            id: 'm1',
            snippet: 'Thanks for the quote',
            internalDate: '1757000000000',
            payload: { headers: [{ name: 'From', value: 'Priya <priya@x.in>' }, { name: 'To', value: 'studio@ipc.in' }, { name: 'Subject', value: 'Re: quote' }] },
          }),
        )
      }
      return new Response(
        JSON.stringify({
          id: 'm2',
          snippet: 'Here it is',
          internalDate: '1757000100000',
          payload: { headers: [{ name: 'From', value: 'studio@ipc.in' }, { name: 'To', value: 'rahul@y.in' }, { name: 'Subject', value: 'Quote' }] },
        }),
      )
    })
    vi.stubGlobal('fetch', fetchMock)
    const out = await fetchRecentMessages({ EMAIL_SYNC_PROVIDER: 'gmail', EMAIL_SYNC_TOKEN: 't', EMAIL_SYNC_MAILBOX: 'studio@ipc.in' })
    expect(out).toEqual([
      { external_id: 'm1', direction: 'in', subject: 'Re: quote', snippet: 'Thanks for the quote', counterpart: 'priya@x.in', at: new Date(1757000000000).toISOString() },
      { external_id: 'm2', direction: 'out', subject: 'Quote', snippet: 'Here it is', counterpart: 'rahul@y.in', at: new Date(1757000100000).toISOString() },
    ])
  })

  it('normalises Microsoft Graph messages the same way', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            value: [
              { id: 'g1', subject: 'Hi', bodyPreview: 'Hello', receivedDateTime: '2026-09-05T10:00:00Z', from: { emailAddress: { address: 'Priya@X.in' } }, toRecipients: [{ emailAddress: { address: 'studio@ipc.in' } }] },
            ],
          }),
        ),
      ),
    )
    const out = await fetchRecentMessages({ EMAIL_SYNC_PROVIDER: 'o365', EMAIL_SYNC_TOKEN: 't', EMAIL_SYNC_MAILBOX: 'studio@ipc.in' })
    expect(out[0]).toMatchObject({ external_id: 'g1', direction: 'in', counterpart: 'priya@x.in', subject: 'Hi' })
  })

  it('throws on a provider refusal', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('denied', { status: 403 })))
    await expect(fetchRecentMessages({ EMAIL_SYNC_PROVIDER: 'gmail', EMAIL_SYNC_TOKEN: 't', EMAIL_SYNC_MAILBOX: 'a@b.in' })).rejects.toThrow(/403/)
  })
})
