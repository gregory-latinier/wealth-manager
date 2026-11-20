import { ProviderError } from '../crypto/providers/types'
import { createKraken, normalizeAsset, sign } from './kraken'

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

const CREDS = { apiKey: 'key-123', apiSecret: Buffer.from('not-a-real-secret').toString('base64') }

const PAIRS = {
  XXBTZUSD: { base: 'XXBT', quote: 'ZUSD', status: 'online' },
  XETHZUSD: { base: 'XETH', quote: 'ZUSD', status: 'online' },
  ZEURZUSD: { base: 'ZEUR', quote: 'ZUSD', status: 'online' },
  XDGUSD: { base: 'XXDG', quote: 'ZUSD', status: 'online' },
  DOTUSD: { base: 'DOT', quote: 'ZUSD', status: 'online' },
  USDTZUSD: { base: 'USDT', quote: 'ZUSD', status: 'online' },
  XBTEUR: { base: 'XXBT', quote: 'ZEUR', status: 'online' }, // not quoted in USD: must be ignored
  OLDUSD: { base: 'OLD', quote: 'ZUSD', status: 'cancel_only' }, // not online: must be ignored
}

/** Answers the three Kraken endpoints from fixtures and records every call. */
function kraken(balance: unknown, tickers: Record<string, string> = {}) {
  const calls: Array<{ url: string; init: RequestInit }> = []
  const impl = (async (url: string, init: RequestInit) => {
    calls.push({ url, init })
    if (url.includes('/private/Balance')) return json(balance)
    if (url.includes('/public/AssetPairs')) return json({ error: [], result: PAIRS })
    if (url.includes('/public/Ticker')) {
      const asked = decodeURIComponent(url.split('pair=')[1]).split(',')
      return json({ error: [], result: Object.fromEntries(asked.filter((p) => tickers[p]).map((p) => [p, { c: [tickers[p], '1'] }])) })
    }
    return json({}, 404)
  }) as unknown as typeof fetch
  return { fetch: impl, calls }
}

describe('sign', () => {
  it('matches the example in the Kraken documentation', () => {
    // https://docs.kraken.com/api/docs/guides/spot-rest-auth
    const secret = 'kQH5HW/8p1uGOVjbgWA7FunAmGO8lsSUXNsu3eow76sz84Q18fWxnyRzBHCd3pd5nE9qa99HAZtuZuj6F1huXg=='
    const post = 'nonce=1616492376594&ordertype=limit&pair=XBTUSD&price=37500&type=buy&volume=1.25'
    expect(sign('/0/private/AddOrder', '1616492376594', post, secret)).toBe(
      '4/dpxb3iT4tp/ZCVEwSnEsLxx0bqyhLpdfOpc6fn7OR8+UClSV5n9E6aSS8MPtnRfp32bAb0nmbRn6H8ndwLUQ=='
    )
  })
})

describe('normalizeAsset', () => {
  it('maps legacy codes and drops the holding-style suffix', () => {
    const codes = ['XXBT', 'XBT.M', 'XETH', 'ETH2.S', 'ETH2', 'DOT.S', 'USDT.F', 'XXDG', 'ZUSD', 'ZEUR', 'SOL', 'USDC.B']
    expect(codes.map(normalizeAsset)).toEqual(['BTC', 'BTC', 'ETH', 'ETH', 'ETH', 'DOT', 'USDT', 'DOGE', 'USD', 'EUR', 'SOL', 'USDC'])
  })

  it('does not mangle real assets that merely start with X or Z', () => {
    expect(normalizeAsset('ZETA')).toBe('ZETA')
    expect(normalizeAsset('XTZ')).toBe('XTZ')
    expect(normalizeAsset('ZRX')).toBe('ZRX')
  })
})

describe('createKraken', () => {
  it('signs a private call with the key, the nonce in the body and a base64 signature', async () => {
    const f = kraken({ error: [], result: {} })
    await createKraken({ fetch: f.fetch, now: () => 1_700_000_000_000 }).verify(CREDS)
    const call = f.calls[0]
    expect(call.url).toBe('https://api.kraken.com/0/private/Balance')
    expect(call.init.method).toBe('POST')
    const headers = call.init.headers as Record<string, string>
    expect(headers['API-Key']).toBe('key-123')
    expect(headers['Content-Type']).toBe('application/x-www-form-urlencoded')
    expect(call.init.body).toBe('nonce=1700000000000000')
    expect(headers['API-Sign']).toBe(sign('/0/private/Balance', '1700000000000000', 'nonce=1700000000000000', CREDS.apiSecret))
  })

  it('never reuses or lowers a nonce, even when the clock stands still', async () => {
    const f = kraken({ error: [], result: {} })
    const adapter = createKraken({ fetch: f.fetch, now: () => 1_700_000_000_000 })
    await adapter.verify(CREDS)
    await adapter.verify(CREDS)
    const nonces = f.calls.map((c) => Number(String(c.init.body).replace('nonce=', '')))
    expect(nonces[1]).toBeGreaterThan(nonces[0])
  })

  it('merges staked variants into one priced line per asset and values USD at 1', async () => {
    const f = kraken(
      { error: [], result: { XXBT: '0.5', 'XBT.M': '0.25', XETH: '2', 'ETH2.S': '1', 'DOT.S': '100', ZUSD: '250.5', ZEUR: '10', XXDG: '0', USDT: '40' } },
      { XXBTZUSD: '60000', XETHZUSD: '1750', DOTUSD: '4.2', ZEURZUSD: '1.1', USDTZUSD: '0.9995' }
    )
    const lines = await createKraken({ fetch: f.fetch }).getBalances(CREDS)
    const by = Object.fromEntries(lines.map((l) => [l.symbol, [l.amount.toString(), l.priceUsd?.toString() ?? null]]))
    expect(by).toEqual({
      BTC: ['0.75', '60000'],
      ETH: ['3', '1750'],
      DOT: ['100', '4.2'],
      USD: ['250.5', '1'],
      EUR: ['10', '1.1'],
      USDT: ['40', '0.9995'],
    })
    expect(lines.find((l) => l.symbol === 'DOGE')).toBeUndefined() // a zero balance is skipped
  })

  it('reports an asset with no USD price as unpriced, never as 0', async () => {
    const f = kraken({ error: [], result: { XXBT: '1', FOO: '5' } }, { XXBTZUSD: '60000' })
    const lines = await createKraken({ fetch: f.fetch }).getBalances(CREDS)
    expect(lines.find((l) => l.symbol === 'FOO')?.priceUsd).toBeNull()
    expect(lines.find((l) => l.symbol === 'BTC')?.priceUsd?.toString()).toBe('60000')
  })

  it('ignores pairs that are not online or not quoted in USD', async () => {
    const f = kraken({ error: [], result: { OLD: '1', XXBT: '1' } }, { XXBTZUSD: '60000', OLDUSD: '9' })
    const lines = await createKraken({ fetch: f.fetch }).getBalances(CREDS)
    expect(lines.find((l) => l.symbol === 'OLD')?.priceUsd).toBeNull()
    const ticker = f.calls.find((c) => c.url.includes('/public/Ticker'))!
    expect(decodeURIComponent(ticker.url)).not.toContain('XBTEUR')
  })

  it('makes no price call for an account that holds only USD', async () => {
    const f = kraken({ error: [], result: { ZUSD: '12' } })
    const lines = await createKraken({ fetch: f.fetch }).getBalances(CREDS)
    expect(lines).toHaveLength(1)
    expect(f.calls.some((c) => c.url.includes('/public/'))).toBe(false)
  })

  it('turns an error list (sent with HTTP 200) into a ProviderError without leaking the request', async () => {
    const f = kraken({ error: ['EAPI:Invalid key'] })
    const err = await createKraken({ fetch: f.fetch }).verify(CREDS).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(ProviderError)
    expect((err as Error).message).toBe('kraken: EAPI:Invalid key')
    expect((err as Error).message).not.toContain(CREDS.apiSecret)
  })

  it('fails on an HTTP error and on a malformed answer', async () => {
    const down = (async () => json({}, 503)) as unknown as typeof fetch
    await expect(createKraken({ fetch: down }).getBalances(CREDS)).rejects.toBeInstanceOf(ProviderError)
    const odd = (async () => json({ error: [] })) as unknown as typeof fetch
    await expect(createKraken({ fetch: odd }).getBalances(CREDS)).rejects.toBeInstanceOf(ProviderError)
  })
})
