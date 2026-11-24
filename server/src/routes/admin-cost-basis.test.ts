import { FastifyInstance } from 'fastify'
import { buildApp } from '../index'
import { pool, query } from '../db/index'
import { SESSION_COOKIE } from '../lib/auth'
import { dec } from '../lib/money'
import { runSnapshot } from '../lib/snapshot'
import type { FxProvider } from '../sources/fx/frankfurter'
import type { SourceType } from '../sources/types'
import { pnlOf } from '../sources/cost-basis'
import { withCost } from '../sources/meta'

const fx: FxProvider = { getUsdPerEur: async () => ({ usdPerEur: dec('1.25'), date: '2026-11-19' }) }

// 0.5 BTC at 60000 = 30000 USD, and 2 ETH at 2000 = 4000 USD. At 1.25 USD per EUR: 24000 EUR and 3200 EUR.
const source = (withEth = true): SourceType => ({
  id: 'crypto',
  collect: async () => ({
    lines: [
      { sourceRef: 'btc:a:native', symbol: 'BTC', amount: dec('0.5'), priceUsd: dec('60000') },
      ...(withEth ? [{ sourceRef: 'eth:b:native', symbol: 'ETH', amount: dec('2'), priceUsd: dec('2000') }] : []),
    ],
    failures: [],
  }),
})

describe('pnlOf and withCost', () => {
  it('has no gain figure without a cost, never a zero', () => {
    expect(pnlOf('100', '80', undefined, '1.25')).toMatchObject({ cost: null, costUsd: null, pnlUsd: null, pnlEur: null, pnlPct: null })
  })
  it('computes the gain and its percentage in decimal math, for a cost in USD', () => {
    // Value 90 USD = 72 EUR. Cost 120 USD = 96 EUR.
    expect(pnlOf('90', '72', { cost: '120', currency: 'USD' }, '1.25')).toEqual({
      cost: '120.00000000',
      costCurrency: 'USD',
      costUsd: '120.00000000',
      costEur: '96.00000000',
      pnlUsd: '-30.00000000',
      pnlEur: '-24.00000000',
      pnlPct: '-25.00',
    })
  })
  it('keeps a cost in EUR exact and converts it with the rate of the snapshot', () => {
    // Cost 96 EUR = 120 USD. Same position, same figures as above.
    expect(pnlOf('90', '72', { cost: '96', currency: 'EUR' }, '1.25')).toEqual({
      cost: '96.00000000',
      costCurrency: 'EUR',
      costUsd: '120.00000000',
      costEur: '96.00000000',
      pnlUsd: '-30.00000000',
      pnlEur: '-24.00000000',
      pnlPct: '-25.00',
    })
  })
  it('has no percentage for a zero cost', () => {
    expect(pnlOf('50', '40', { cost: '0', currency: 'EUR' }, '1.25')).toMatchObject({ pnlUsd: '50.00000000', pnlEur: '40.00000000', pnlPct: null })
  })
  it('only turns an available holding into at_loss', () => {
    expect(withCost('available', '-1')).toBe('at_loss')
    expect(withCost('available', '0.00000000')).toBe('available')
    expect(withCost('available', '5')).toBe('available')
    expect(withCost('available', null)).toBe('available')
    expect(withCost('locked', '-1')).toBe('locked')
    expect(withCost('borrowed', '-1')).toBe('borrowed')
  })
})

describe('cost basis', () => {
  let app: FastifyInstance
  let cookies: Record<string, string>

  beforeAll(async () => {
    app = await buildApp()
    await app.ready()
    await query('DELETE FROM "Session"')
    const login = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { password: 'correct-horse-battery' } })
    cookies = { [SESSION_COOKIE]: login.cookies.find((c) => c.name === SESSION_COOKIE)!.value }
  })
  beforeEach(async () => {
    await query('DELETE FROM "CostBasis"')
    await query('DELETE FROM "SnapshotLine"')
    await query('DELETE FROM "Snapshot"')
  })
  afterAll(async () => {
    await app.close()
    await pool.end()
  })

  const put = (payload: object, authed = true) => app.inject({ method: 'PUT', url: '/api/admin/cost-basis', payload, cookies: authed ? cookies : {} })
  const del = (qs: string) => app.inject({ method: 'DELETE', url: `/api/admin/cost-basis?${qs}`, cookies })
  const dashboard = async (url = '/api/dashboard') => (await app.inject({ method: 'GET', url, cookies })).json()
  const lines = async () => (await dashboard()).breakdown.lines as Array<Record<string, unknown>>
  const snap = (date: string, src = source()) => runSnapshot({ sources: [src], fx, now: new Date(`${date}T12:00:00Z`) })
  const btc = { sourceType: 'crypto', sourceRef: 'btc:a:native' }
  const eth = { sourceType: 'crypto', sourceRef: 'eth:b:native' }

  it('requires a session', async () => {
    expect((await put({ ...btc, cost: '1', currency: 'USD' }, false)).statusCode).toBe(401)
  })

  it('stores a cost with its currency, replaces it, and lists it', async () => {
    expect((await put({ ...btc, cost: '25000', currency: 'USD' })).statusCode).toBe(200)
    await put({ ...btc, cost: '26000.5', currency: 'EUR' })
    const res = await app.inject({ method: 'GET', url: '/api/admin/cost-basis', cookies })
    expect(res.json().costs).toEqual([{ ...btc, cost: '26000.50000000', currency: 'EUR' }])
  })

  it('rejects a negative, malformed or over-precise cost, and an unknown currency', async () => {
    for (const cost of ['-1', 'abc', '1e5', '1.123456789', '']) expect((await put({ ...btc, cost, currency: 'USD' })).statusCode).toBe(400)
    expect((await put({ ...btc, cost: '1', currency: 'GBP' })).statusCode).toBe(400)
    expect((await put({ ...btc, cost: '1' })).statusCode).toBe(400) // the currency is required, never guessed
  })

  it('deletes a cost, and says so when there is none', async () => {
    await put({ ...btc, cost: '1', currency: 'USD' })
    expect((await del('sourceType=crypto&sourceRef=btc%3Aa%3Anative')).statusCode).toBe(204)
    expect((await del('sourceType=crypto&sourceRef=btc%3Aa%3Anative')).statusCode).toBe(404)
  })

  it('shows the gain per line in both currencies, and marks an available line worth less than its cost as at_loss', async () => {
    await snap('2026-11-19')
    await put({ ...btc, cost: '40000', currency: 'USD' }) // worth 30000 USD: a loss of 10000
    await put({ ...eth, cost: '2400', currency: 'EUR' }) // 2400 EUR = 3000 USD, worth 4000: a gain of 1000 USD, 800 EUR
    const [b, e] = await lines()
    expect(b).toMatchObject({ symbol: 'BTC', pnlUsd: '-10000.00000000', pnlEur: '-8000.00000000', pnlPct: '-25.00', status: 'at_loss' })
    expect(e).toMatchObject({ symbol: 'ETH', cost: '2400.00000000', costCurrency: 'EUR', costUsd: '3000.00000000', pnlUsd: '1000.00000000', pnlEur: '800.00000000', pnlPct: '33.33', status: 'available' })
  })

  it('leaves a line without a cost at null, available', async () => {
    await snap('2026-11-19')
    expect((await lines())[0]).toMatchObject({ cost: null, costUsd: null, pnlUsd: null, pnlEur: null, pnlPct: null, status: 'available' })
  })

  describe('costs left behind', () => {
    it('reports a cost whose position is not in the latest snapshot, with the last symbol seen', async () => {
      await snap('2026-11-18') // BTC and ETH
      await snap('2026-11-19', source(false)) // ETH sold: gone from the latest snapshot
      await put({ ...btc, cost: '1', currency: 'USD' })
      await put({ ...eth, cost: '2', currency: 'EUR' })
      expect((await dashboard()).orphanCosts).toEqual([{ ...eth, cost: '2.00000000', currency: 'EUR', symbol: 'ETH' }])
    })

    it('reports a cost for a position that never appeared, with no symbol', async () => {
      await snap('2026-11-19')
      await put({ sourceType: 'crypto', sourceRef: 'btc:zzz:native', cost: '5', currency: 'USD' })
      expect((await dashboard()).orphanCosts).toEqual([{ sourceType: 'crypto', sourceRef: 'btc:zzz:native', cost: '5.00000000', currency: 'USD', symbol: null }])
    })

    it('does not flag a cost because an older day is being viewed', async () => {
      await snap('2026-11-18', source(false)) // only BTC
      await snap('2026-11-19') // BTC and ETH
      await put({ ...eth, cost: '2', currency: 'USD' })
      // Looking at the 18th, where ETH is absent: it is still held today, so not left behind.
      expect((await dashboard('/api/dashboard?date=2026-11-18')).orphanCosts).toEqual([])
    })

    it('is empty with no cost, and the cost can then be removed', async () => {
      await snap('2026-11-19')
      expect((await dashboard()).orphanCosts).toEqual([])
      await put({ sourceType: 'crypto', sourceRef: 'btc:zzz:native', cost: '5', currency: 'USD' })
      expect((await dashboard()).orphanCosts).toHaveLength(1)
      await del('sourceType=crypto&sourceRef=btc%3Azzz%3Anative')
      expect((await dashboard()).orphanCosts).toEqual([])
    })
  })
})
