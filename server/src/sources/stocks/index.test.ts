import { dec } from '../../lib/money'
import { ProviderError } from '../crypto/providers/types'
import type { StockHolding } from './holdings'
import { createStocksSource, holdingRef } from './index'
import { createYahooQuotes, createYahooSearch, parseChart, parseSearch, UnknownSymbolError, type Quote, type QuoteProvider } from './yahoo'

const NOW = new Date('2026-11-23T12:00:00Z')
const TRADED = Math.floor(new Date('2026-11-23T10:00:00Z').getTime() / 1000)

const holding = (over: Partial<StockHolding> = {}): StockHolding => ({
  id: 'st1',
  symbol: 'JEQP.DE',
  name: 'JPM Nasdaq Equity Premium Income Active UCITS ETF',
  broker: 'Trade Republic',
  currency: 'EUR',
  quantity: '100',
  active: true,
  createdAt: '2026-11-20T00:00:00Z',
  ...over,
})

const quote = (over: Partial<Quote> = {}): Quote => ({ symbol: 'JEQP.DE', name: 'JEQP', currency: 'EUR', price: dec('21.795'), time: NOW, ...over })
const quotesOf = (byTicker: Record<string, Quote | Error>): QuoteProvider => ({
  getQuote: async (symbol) => {
    const q = byTicker[symbol]
    if (!q) throw new UnknownSymbolError(symbol)
    if (q instanceof Error) throw q
    return q
  },
})
const build = (list: StockHolding[], byTicker: Record<string, Quote | Error>) => createStocksSource({ holdings: async () => list, quotes: quotesOf(byTicker) })
const ctx = { date: '2026-11-23', usdPerEur: dec('1.25') }

const chart = (meta: Record<string, unknown>) => ({ chart: { result: [{ meta }], error: null } })
const goodMeta = { symbol: 'JEQP.DE', currency: 'EUR', longName: 'JPM Nasdaq Equity Premium Income Active UCITS ETF USD Dist', regularMarketPrice: 21.795, regularMarketTime: TRADED }

describe('stocks source', () => {
  it('values a EUR listing at its EUR price converted with the engine rate', async () => {
    const res = await build([holding()], { 'JEQP.DE': quote() }).collect(ctx)
    expect(res.failures).toEqual([])
    expect(res.lines.map((l) => [l.sourceRef, l.symbol, l.amount.toString(), l.priceUsd.toString()])).toEqual([['st1:JEQP.DE', 'JEQP.DE', '100', '27.24375']])
    // The engine converts back with the same rate, so the EUR value is exactly quantity times the EUR price.
    expect(res.lines[0]!.amount.mul(res.lines[0]!.priceUsd).div(ctx.usdPerEur).toString()).toBe('2179.5')
  })

  it('values a USD listing at its USD price, with no rate needed', async () => {
    const h = holding({ id: 'st2', symbol: 'VOO', currency: 'USD', quantity: '2.5' })
    const res = await build([h], { VOO: quote({ symbol: 'VOO', currency: 'USD', price: dec('500') }) }).collect({ date: '2026-11-23' })
    expect(res.lines.map((l) => [l.sourceRef, l.priceUsd.toString()])).toEqual([['st2:VOO', '500']])
  })

  it('fails a EUR listing when the rate is unavailable, never values it at 0', async () => {
    const res = await build([holding()], { 'JEQP.DE': quote() }).collect({ date: '2026-11-23' })
    expect(res.lines).toEqual([])
    expect(res.failures).toEqual([{ sourceRef: holdingRef(holding()), reason: expect.stringContaining('rate') }])
  })

  it('fails only the listing whose price cannot be read', async () => {
    const other = holding({ id: 'st2', symbol: 'IWDA.AS' })
    const res = await build([holding(), other], { 'JEQP.DE': quote(), 'IWDA.AS': new ProviderError('yahoo', 'http', 'HTTP 500') }).collect(ctx)
    expect(res.lines.map((l) => l.sourceRef)).toEqual(['st1:JEQP.DE'])
    expect(res.failures).toEqual([{ sourceRef: 'st2:IWDA.AS', reason: expect.stringContaining('HTTP 500') }])
  })

  it('fails a listing that changed currency instead of mixing up the price', async () => {
    const res = await build([holding()], { 'JEQP.DE': quote({ currency: 'GBp' }) }).collect(ctx)
    expect(res.lines).toEqual([])
    expect(res.failures[0]!.reason).toContain('GBp')
  })

  it('returns nothing when no holding is tracked', async () => {
    expect(await build([], {}).collect(ctx)).toEqual({ lines: [], failures: [] })
  })
})

describe('parseChart', () => {
  it('reads price, currency and name', () => {
    const q = parseChart(chart(goodMeta), 'JEQP.DE', NOW)
    expect(q).toMatchObject({ symbol: 'JEQP.DE', currency: 'EUR', name: 'JPM Nasdaq Equity Premium Income Active UCITS ETF USD Dist' })
    expect(q.price.toString()).toBe('21.795')
  })

  it('reports an unknown ticker as such', () => {
    expect(() => parseChart({ chart: { result: null, error: { code: 'Not Found' } } }, 'NOPE', NOW)).toThrow(UnknownSymbolError)
  })

  it.each([
    ['a zero price', { regularMarketPrice: 0 }],
    ['a missing price', { regularMarketPrice: undefined }],
    ['a price as text', { regularMarketPrice: '21.8' }],
    ['no currency', { currency: undefined }],
    ['no trade time', { regularMarketTime: undefined }],
    ['a stale last trade', { regularMarketTime: TRADED - 30 * 86_400 }],
  ])('refuses %s instead of returning a price', (_name, over) => {
    expect(() => parseChart(chart({ ...goodMeta, ...over }), 'JEQP.DE', NOW)).toThrow(ProviderError)
  })

  it('refuses a payload that is not a chart', () => {
    expect(() => parseChart({ foo: 1 }, 'JEQP.DE', NOW)).toThrow(ProviderError)
    expect(() => parseChart(null, 'JEQP.DE', NOW)).toThrow(ProviderError)
  })
})

describe('parseSearch', () => {
  const entry = (over: Record<string, unknown>) => ({ symbol: 'jeqp.de', quoteType: 'ETF', exchDisp: 'XETRA', longname: 'JPM Nasdaq', shortname: 'JPM', ...over })

  it('reads symbol, name, type and exchange, with the symbol uppercased', () => {
    expect(parseSearch({ quotes: [entry({})] })).toEqual([{ symbol: 'JEQP.DE', name: 'JPM Nasdaq', type: 'ETF', exchange: 'XETRA' }])
  })

  it('falls back to the short name, then the symbol, and to the exchange code', () => {
    const hits = parseSearch({ quotes: [entry({ longname: undefined }), entry({ longname: undefined, shortname: undefined, exchDisp: undefined, exchange: 'GER' })] })
    expect(hits.map((h) => [h.name, h.exchange])).toEqual([['JPM', 'XETRA'], ['jeqp.de'.toUpperCase(), 'GER']])
  })

  it('leaves out what cannot be held: indexes, currencies, crypto and entries without a symbol', () => {
    const hits = parseSearch({ quotes: [entry({ quoteType: 'INDEX' }), entry({ quoteType: 'CURRENCY' }), entry({ quoteType: 'CRYPTOCURRENCY' }), entry({ symbol: '' }), entry({ symbol: undefined }), entry({ symbol: 'VOO' })] })
    expect(hits.map((h) => h.symbol)).toEqual(['VOO'])
  })

  it('refuses a payload without a quotes array', () => {
    expect(() => parseSearch({})).toThrow(ProviderError)
    expect(() => parseSearch(null)).toThrow(ProviderError)
  })
})

describe('createYahooSearch', () => {
  it('sends the text encoded, with a browser user agent', async () => {
    let seen: { url: string; ua: string | undefined } | undefined
    const fetchSpy = (async (url: string, init: RequestInit) => {
      seen = { url, ua: (init.headers as Record<string, string>)['User-Agent'] }
      return new Response(JSON.stringify({ quotes: [] }), { status: 200 })
    }) as unknown as typeof fetch
    expect(await createYahooSearch({ fetch: fetchSpy }).search('vanguard s&p')).toEqual([])
    expect(seen!.url).toContain('q=vanguard%20s%26p')
    expect(seen!.ua).toContain('Mozilla')
  })

  it('turns an HTTP failure into a provider error', async () => {
    const down = (async () => new Response('{}', { status: 429 })) as unknown as typeof fetch
    await expect(createYahooSearch({ fetch: down }).search('jeqp')).rejects.toBeInstanceOf(ProviderError)
  })
})

describe('createYahooQuotes', () => {
  const fetchOf = (status: number, body: unknown) => (async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch

  it('asks for the ticker, encoded, with a browser user agent', async () => {
    let seen: { url: string; ua: string | undefined } | undefined
    const fetchSpy = (async (url: string, init: RequestInit) => {
      seen = { url, ua: (init.headers as Record<string, string>)['User-Agent'] }
      return new Response(JSON.stringify(chart(goodMeta)), { status: 200 })
    }) as unknown as typeof fetch
    await createYahooQuotes({ fetch: fetchSpy, now: () => NOW }).getQuote('JEQP.DE')
    expect(seen!.url).toContain('/chart/JEQP.DE?')
    expect(seen!.ua).toContain('Mozilla')
  })

  it('maps an HTTP 404 to an unknown ticker and other failures to a provider error', async () => {
    await expect(createYahooQuotes({ fetch: fetchOf(404, {}) }).getQuote('NOPE')).rejects.toBeInstanceOf(UnknownSymbolError)
    await expect(createYahooQuotes({ fetch: fetchOf(429, {}) }).getQuote('JEQP.DE')).rejects.toBeInstanceOf(ProviderError)
  })
})
