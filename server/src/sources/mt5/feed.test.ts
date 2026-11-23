import { ProviderError } from '../crypto/providers/types'
import { FeedNotConfiguredError, createMt5Feed, parseFeed } from './feed'

const NOW = new Date('2026-11-23T16:00:00Z')
const row = (over: Record<string, unknown> = {}) => ({
  account: '37363418',
  name: 'Pips Grinder Cent Copy x30',
  broker: 'RoboForex',
  balance: 9821.35,
  equity: 9780.86,
  updatedAt: '2026-11-23 16:33:23+01',
  status: 'ok',
  ...over,
})

describe('parseFeed', () => {
  it('reads the balance, not the equity, of a healthy account', () => {
    const [a] = parseFeed({ allAccounts: [row()] }, NOW)
    expect(a).toMatchObject({ login: '37363418', name: 'Pips Grinder Cent Copy x30', broker: 'RoboForex', problem: null })
    expect(a!.balance!.toString()).toBe('9821.35')
    expect(a!.updatedAt!.toISOString()).toBe('2026-11-23T15:33:23.000Z')
  })

  it('accepts a login sent as a number', () => {
    expect(parseFeed({ allAccounts: [row({ account: 52012637 })] }, NOW)[0]!.login).toBe('52012637')
  })

  it('keeps an error row with its reason and no balance, never a balance of 0', () => {
    const [a] = parseFeed({ allAccounts: [row({ balance: 0, status: 'error: terminal not connected' })] }, NOW)
    expect(a).toMatchObject({ balance: null, problem: 'error: terminal not connected' })
  })

  it('refuses an account the collector has not updated for days', () => {
    const [a] = parseFeed({ allAccounts: [row({ updatedAt: '2026-11-18 10:00:00+01' })] }, NOW)
    expect(a!.balance).toBeNull()
    expect(a!.problem).toContain('too old')
  })

  it('refuses a missing or non numeric balance and a missing update time', () => {
    const [noBalance, textBalance, noTime] = parseFeed({ allAccounts: [row({ balance: undefined }), row({ account: '2', balance: '12' }), row({ account: '3', updatedAt: undefined })] }, NOW)
    expect([noBalance!.balance, textBalance!.balance, noTime!.balance]).toEqual([null, null, null])
    expect(noBalance!.problem).toBe('no valid balance')
    expect(noTime!.problem).toBe('no update time')
  })

  it('skips a row without a login', () => {
    expect(parseFeed({ allAccounts: [row({ account: '' }), {}, null] }, NOW)).toEqual([])
  })

  it('rejects a payload without the account list', () => {
    expect(() => parseFeed({ totals: {} }, NOW)).toThrow(ProviderError)
    expect(() => parseFeed(null, NOW)).toThrow(ProviderError)
  })
})

describe('createMt5Feed', () => {
  const json = (body: unknown, status = 200) => async () => new Response(JSON.stringify(body), { status })

  it('fetches the configured url and parses it', async () => {
    let seen = ''
    const feed = createMt5Feed({
      getUrl: async () => 'https://feed.test/snapshot',
      now: () => NOW,
      fetch: (async (url: string) => {
        seen = url
        return new Response(JSON.stringify({ allAccounts: [row()] }))
      }) as unknown as typeof fetch,
    })
    expect((await feed.accounts()).map((a) => a.login)).toEqual(['37363418'])
    expect(seen).toBe('https://feed.test/snapshot')
  })

  it('does not fetch anything when no URL is set', async () => {
    const fetchSpy = jest.fn()
    const feed = createMt5Feed({ getUrl: async () => null, fetch: fetchSpy as unknown as typeof fetch })
    await expect(feed.accounts()).rejects.toBeInstanceOf(FeedNotConfiguredError)
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('turns an HTTP error into a ProviderError', async () => {
    const feed = createMt5Feed({ getUrl: async () => 'https://feed.test/x', fetch: json({}, 502) as unknown as typeof fetch })
    await expect(feed.accounts()).rejects.toBeInstanceOf(ProviderError)
  })
})
