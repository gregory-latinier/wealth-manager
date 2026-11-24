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

// 0.5 BTC at 60000 = 30000 USD, and 2 ETH at 2000 = 4000 USD.
const source: SourceType = {
  id: 'crypto',
  collect: async () => ({
    lines: [
      { sourceRef: 'btc:a:native', symbol: 'BTC', amount: dec('0.5'), priceUsd: dec('60000') },
      { sourceRef: 'eth:b:native', symbol: 'ETH', amount: dec('2'), priceUsd: dec('2000') },
    ],
    failures: [],
  }),
}

describe('pnlOf and withCost', () => {
  it('has no gain figure without a cost, never a zero', () => {
    expect(pnlOf('100', undefined)).toEqual({ costUsd: null, pnlUsd: null, pnlPct: null })
  })
  it('computes the gain and its percentage in decimal math', () => {
    expect(pnlOf('90', '120')).toEqual({ costUsd: '120.00000000', pnlUsd: '-30.00000000', pnlPct: '-25.00' })
  })
  it('has no percentage for a zero cost', () => {
    expect(pnlOf('50', '0')).toMatchObject({ pnlUsd: '50.00000000', pnlPct: null })
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
  const lines = async () => (await app.inject({ method: 'GET', url: '/api/dashboard', cookies })).json().breakdown.lines as Array<Record<string, unknown>>
  const btc = { sourceType: 'crypto', sourceRef: 'btc:a:native' }

  it('requires a session', async () => {
    expect((await put({ ...btc, costUsd: '1' }, false)).statusCode).toBe(401)
  })

  it('stores a cost, replaces it, and lists it', async () => {
    expect((await put({ ...btc, costUsd: '25000' })).statusCode).toBe(200)
    await put({ ...btc, costUsd: '26000.5' })
    const res = await app.inject({ method: 'GET', url: '/api/admin/cost-basis', cookies })
    expect(res.json().costs).toEqual([{ ...btc, costUsd: '26000.50000000' }])
  })

  it('rejects a negative, malformed or over-precise cost', async () => {
    for (const costUsd of ['-1', 'abc', '1e5', '1.123456789', '']) expect((await put({ ...btc, costUsd })).statusCode).toBe(400)
  })

  it('deletes a cost, and says so when there is none', async () => {
    await put({ ...btc, costUsd: '1' })
    expect((await del('sourceType=crypto&sourceRef=btc%3Aa%3Anative')).statusCode).toBe(204)
    expect((await del('sourceType=crypto&sourceRef=btc%3Aa%3Anative')).statusCode).toBe(404)
  })

  it('shows the gain per line, and marks an available line worth less than its cost as at_loss', async () => {
    await runSnapshot({ sources: [source], fx, now: new Date('2026-11-19T12:00:00Z') })
    await put({ ...btc, costUsd: '40000' }) // worth 30000: a loss of 10000
    await put({ sourceType: 'crypto', sourceRef: 'eth:b:native', costUsd: '3000' }) // worth 4000: a gain
    const [b, e] = await lines()
    expect(b).toMatchObject({ symbol: 'BTC', costUsd: '40000.00000000', pnlUsd: '-10000.00000000', pnlPct: '-25.00', status: 'at_loss' })
    expect(e).toMatchObject({ symbol: 'ETH', pnlUsd: '1000.00000000', pnlPct: '33.33', status: 'available' })
  })

  it('leaves a line without a cost at null, available', async () => {
    await runSnapshot({ sources: [source], fx, now: new Date('2026-11-19T12:00:00Z') })
    expect((await lines())[0]).toMatchObject({ costUsd: null, pnlUsd: null, pnlPct: null, status: 'available' })
  })
})
