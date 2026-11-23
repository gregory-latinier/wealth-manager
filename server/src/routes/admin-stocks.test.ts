import { FastifyInstance } from 'fastify'
import { buildApp } from '../index'
import { pool, query } from '../db/index'
import { SESSION_COOKIE } from '../lib/auth'
import { dec } from '../lib/money'
import { ProviderError } from '../sources/crypto/providers/types'
import { activeHoldings } from '../sources/stocks/holdings'
import { UnknownSymbolError, type Quote, type QuoteProvider, type SearchHit, type SymbolSearch } from '../sources/stocks/yahoo'

const quote = (symbol: string, currency: string, name = 'JPM Nasdaq Equity Premium Income Active UCITS ETF USD Dist'): Quote => ({
  symbol,
  name,
  currency,
  price: dec('21.795'),
  time: new Date(),
})

let lookups: string[] = []
const quotes: QuoteProvider = {
  getQuote: async (symbol) => {
    lookups.push(symbol)
    if (symbol === 'JEQP.DE') return quote(symbol, 'EUR')
    if (symbol === 'JEQP.L') return quote(symbol, 'GBp')
    if (symbol === 'VOO') return quote(symbol, 'USD', 'Vanguard S&P 500 ETF')
    if (symbol === 'DOWN') throw new ProviderError('yahoo', 'http', 'HTTP 500')
    throw new UnknownSymbolError(symbol)
  },
}

const hit = (symbol: string, exchange: string, type = 'ETF'): SearchHit => ({ symbol, name: 'JPM Nasdaq Equity Premium Income Active UCITS ETF USD Dist', type, exchange })
let searched: string[] = []
let searchResult: SearchHit[] | Error = []
const search: SymbolSearch = {
  search: async (text) => {
    searched.push(text)
    if (searchResult instanceof Error) throw searchResult
    return searchResult
  },
}

describe('admin stocks', () => {
  let app: FastifyInstance
  let cookies: Record<string, string>
  let client = 0
  let remoteAddress = ''

  beforeAll(async () => {
    app = await buildApp({ adminStocks: { quotes, search } })
    await app.ready()
    await query('DELETE FROM "Session"')
    const login = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { password: 'correct-horse-battery' } })
    cookies = { [SESSION_COOKIE]: login.cookies.find((c) => c.name === SESSION_COOKIE)!.value }
  })

  beforeEach(async () => {
    remoteAddress = `10.42.0.${++client}`
    lookups = []
    searched = []
    searchResult = []
    await query('DELETE FROM "StockHolding"')
    await query('DELETE FROM "SnapshotLine"')
    await query('DELETE FROM "Snapshot"')
  })

  afterAll(async () => {
    await app.close()
    await pool.end()
  })

  const add = (payload: unknown) => app.inject({ method: 'POST', url: '/api/admin/stocks/holdings', payload: payload as object, cookies, remoteAddress })
  const main = { symbol: 'JEQP.DE', broker: 'Trade Republic', quantity: '100' }

  it('requires a session on every route', async () => {
    const created = (await add(main)).json()
    const calls = [
      { method: 'GET', url: '/api/admin/stocks/holdings' },
      { method: 'POST', url: '/api/admin/stocks/holdings', payload: main },
      { method: 'PATCH', url: `/api/admin/stocks/holdings/${created.id}`, payload: { quantity: '1' } },
      { method: 'DELETE', url: `/api/admin/stocks/holdings/${created.id}` },
    ] as const
    for (const call of calls) {
      const res = await app.inject({ ...call })
      expect([call.method, call.url, res.statusCode]).toEqual([call.method, call.url, 401])
    }
    expect((await query('SELECT 1 FROM "StockHolding"')).rowCount).toBe(1)
  })

  const find = (q: string, authed = true) => app.inject({ method: 'GET', url: `/api/admin/stocks/search?q=${encodeURIComponent(q)}`, cookies: authed ? cookies : {}, remoteAddress })

  it('searches by name, pricing each hit and listing the ones that can be added first', async () => {
    searchResult = [hit('JEQP.L', 'London'), hit('JEQP.DE', 'XETRA'), hit('GONE', 'Nowhere'), hit('VOO', 'NYSEArca')]
    const res = await find('jeqp')
    expect(res.statusCode).toBe(200)
    expect(searched).toEqual(['jeqp'])
    expect(res.json().results.map((r: { symbol: string; supported: boolean }) => [r.symbol, r.supported])).toEqual([
      ['JEQP.DE', true],
      ['VOO', true],
      ['JEQP.L', false],
      ['GONE', false],
    ])
    const [de, , london, gone] = res.json().results
    expect(de).toMatchObject({ currency: 'EUR', price: '21.795', exchange: 'XETRA', reason: null })
    expect(london).toMatchObject({ currency: 'GBp', reason: expect.stringContaining('GBp') })
    expect(gone).toMatchObject({ currency: null, price: null, reason: 'No price available' })
  })

  it('keeps a hit whose price lookup failed, flagged, instead of failing the whole search', async () => {
    searchResult = [hit('DOWN', 'XETRA'), hit('JEQP.DE', 'XETRA')]
    const res = await find('jeqp')
    expect(res.statusCode).toBe(200)
    expect(res.json().results[1]).toMatchObject({ symbol: 'DOWN', supported: false, reason: expect.stringContaining('HTTP 500') })
  })

  it('returns an empty list when nothing matches, and 502 when the search provider is down', async () => {
    expect((await find('zzzz')).json()).toEqual({ results: [] })
    searchResult = new ProviderError('yahoo', 'http', 'HTTP 429')
    const res = await find('jeqp')
    expect(res.statusCode).toBe(502)
    expect(res.json().error).toContain('HTTP 429')
  })

  it('requires a session and a query of at least 2 characters, without calling Yahoo', async () => {
    expect((await find('jeqp', false)).statusCode).toBe(401)
    expect((await find('j')).statusCode).toBe(400)
    expect((await find(' j ')).statusCode).toBe(400)
    expect((await find('x'.repeat(61))).statusCode).toBe(400)
    expect((await app.inject({ method: 'GET', url: '/api/admin/stocks/search', cookies, remoteAddress })).statusCode).toBe(400)
    expect(searched).toEqual([])
  })

  it('reads the name and currency from the listing, and uppercases the ticker', async () => {
    const res = await add({ symbol: ' jeqp.de ', broker: ' Trade Republic ', quantity: '12.5' })
    expect(res.statusCode).toBe(201)
    expect(res.json()).toMatchObject({
      symbol: 'JEQP.DE',
      name: 'JPM Nasdaq Equity Premium Income Active UCITS ETF USD Dist',
      broker: 'Trade Republic',
      currency: 'EUR',
      quantity: '12.500000',
      active: true,
    })
    expect(lookups).toEqual(['JEQP.DE'])
  })

  it('accepts a USD listing, fractional shares and no broker', async () => {
    expect((await add({ symbol: 'VOO', quantity: '0.123456' })).json()).toMatchObject({ currency: 'USD', broker: '', quantity: '0.123456' })
  })

  it('refuses a listing quoted in pence and points at a EUR listing', async () => {
    const res = await add({ symbol: 'JEQP.L', quantity: '10' })
    expect(res.statusCode).toBe(400)
    expect(res.json().error).toContain('GBp')
    expect((await query('SELECT 1 FROM "StockHolding"')).rowCount).toBe(0)
  })

  it('refuses an unknown ticker with a hint, and answers 502 when the price provider is down', async () => {
    const unknown = await add({ symbol: 'NOPE.XX', quantity: '1' })
    expect(unknown.statusCode).toBe(400)
    expect(unknown.json().error).toContain('NOPE.XX')
    const down = await add({ symbol: 'DOWN', quantity: '1' })
    expect(down.statusCode).toBe(502)
    expect((await query('SELECT 1 FROM "StockHolding"')).rowCount).toBe(0)
  })

  it.each([
    ['zero', '0'],
    ['an exponent', '1e3'],
    ['seven decimals', '1.1234567'],
    ['a negative number', '-5'],
    ['text', 'abc'],
  ])('rejects a quantity of %s without calling the provider', async (_name, quantity) => {
    expect((await add({ ...main, quantity })).statusCode).toBe(400)
    expect(lookups).toEqual([])
  })

  it.each([['a space', 'JE QP'], ['a slash', 'JEQP/DE'], ['a script', '<script>']])('rejects a ticker with %s', async (_name, symbol) => {
    expect((await add({ ...main, symbol })).statusCode).toBe(400)
    expect(lookups).toEqual([])
  })

  it('rejects unknown fields, so currency and name cannot be forced', async () => {
    expect((await add({ ...main, currency: 'USD' })).statusCode).toBe(400)
    expect((await add({ ...main, name: 'Mine' })).statusCode).toBe(400)
  })

  it('refuses the same listing twice at the same broker, but allows another broker', async () => {
    expect((await add(main)).statusCode).toBe(201)
    expect((await add(main)).statusCode).toBe(409)
    expect((await add({ ...main, broker: 'Degiro' })).statusCode).toBe(201)
    expect((await query('SELECT 1 FROM "StockHolding"')).rowCount).toBe(2)
  })

  it('lists holdings with their value from the latest snapshot', async () => {
    const created = (await add(main)).json()
    const before = await app.inject({ method: 'GET', url: '/api/admin/stocks/holdings', cookies })
    expect(before.json().holdings[0]).toMatchObject({ id: created.id, lastValue: null })

    await query(`INSERT INTO "Snapshot" ("id", "date", "totalUsd", "totalEur", "usdPerEur", "status") VALUES ('s1', '2026-11-20', 100, 90, 1.25, 'complete')`)
    await query(
      `INSERT INTO "SnapshotLine" ("id", "snapshotId", "sourceType", "sourceRef", "symbol", "amount", "priceUsd", "valueUsd", "valueEur", "stale")
       VALUES ('l1', 's1', 'stocks', $1, 'JEQP.DE', 100, 27.24375, 2724.375, 2179.5, false)`,
      [`${created.id}:JEQP.DE`]
    )
    const after = await app.inject({ method: 'GET', url: '/api/admin/stocks/holdings', cookies })
    expect(after.json().holdings[0].lastValue).toMatchObject({ eur: '2179.50000000', date: '2026-11-20', stale: false })
  })

  it('updates the quantity and broker, pauses, and a paused holding is no longer counted', async () => {
    const created = (await add(main)).json()
    const patch = (payload: object) => app.inject({ method: 'PATCH', url: `/api/admin/stocks/holdings/${created.id}`, payload, cookies, remoteAddress })

    expect((await patch({ quantity: '150.5' })).json()).toMatchObject({ quantity: '150.500000' })
    expect((await patch({ broker: ' Degiro ' })).json()).toMatchObject({ broker: 'Degiro' })
    expect((await patch({ active: false })).json()).toMatchObject({ active: false })
    expect(await activeHoldings()).toEqual([])
    expect((await patch({ active: true })).json()).toMatchObject({ active: true })
    expect(await activeHoldings()).toHaveLength(1)
  })

  it('refuses to change the ticker or currency, a bad quantity and an empty patch', async () => {
    const created = (await add(main)).json()
    const patch = (payload: object) => app.inject({ method: 'PATCH', url: `/api/admin/stocks/holdings/${created.id}`, payload, cookies, remoteAddress })
    expect((await patch({ symbol: 'VOO' })).statusCode).toBe(400)
    expect((await patch({ currency: 'USD' })).statusCode).toBe(400)
    expect((await patch({ quantity: '0' })).statusCode).toBe(400)
    expect((await patch({})).statusCode).toBe(400)
  })

  it('answers 409 when moving a holding to a broker that already has it', async () => {
    await add({ ...main, broker: 'Degiro' })
    const created = (await add(main)).json()
    const res = await app.inject({ method: 'PATCH', url: `/api/admin/stocks/holdings/${created.id}`, payload: { broker: 'Degiro' }, cookies, remoteAddress })
    expect(res.statusCode).toBe(409)
  })

  it('answers 404 for an unknown holding', async () => {
    const patch = await app.inject({ method: 'PATCH', url: '/api/admin/stocks/holdings/nope', payload: { quantity: '1' }, cookies, remoteAddress })
    expect(patch.statusCode).toBe(404)
    const del = await app.inject({ method: 'DELETE', url: '/api/admin/stocks/holdings/nope', cookies, remoteAddress })
    expect(del.statusCode).toBe(404)
  })

  it('deletes a holding and leaves snapshot history alone', async () => {
    const created = (await add(main)).json()
    await query(`INSERT INTO "Snapshot" ("id", "date", "totalUsd", "totalEur", "usdPerEur", "status") VALUES ('s1', '2026-11-20', 100, 90, 1.25, 'complete')`)
    await query(
      `INSERT INTO "SnapshotLine" ("id", "snapshotId", "sourceType", "sourceRef", "symbol", "amount", "priceUsd", "valueUsd", "valueEur", "stale")
       VALUES ('l1', 's1', 'stocks', $1, 'JEQP.DE', 10, 27.24375, 272.4375, 217.95, false)`,
      [`${created.id}:JEQP.DE`]
    )
    const res = await app.inject({ method: 'DELETE', url: `/api/admin/stocks/holdings/${created.id}`, cookies, remoteAddress })
    expect(res.statusCode).toBe(204)
    expect((await query('SELECT 1 FROM "StockHolding"')).rowCount).toBe(0)
    expect((await query('SELECT 1 FROM "SnapshotLine"')).rowCount).toBe(1)
  })
})
