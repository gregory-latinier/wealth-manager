import { FastifyInstance } from 'fastify'
import { buildApp } from '../index'
import { pool, query } from '../db/index'
import { SESSION_COOKIE } from '../lib/auth'
import { dec } from '../lib/money'
import { runSnapshot } from '../lib/snapshot'
import type { FxProvider } from '../sources/fx/frankfurter'
import type { SourceType } from '../sources/types'

const fx: FxProvider = { getUsdPerEur: async () => ({ usdPerEur: dec('1.25'), date: '2026-11-19' }) }

/** One BTC line (0.5 BTC) at the given price, plus one ETH line that can fail. */
const source = (btcPrice: string, ethFails = false): SourceType => ({
  id: 'crypto',
  collect: async () => ({
    lines: [
      { sourceRef: 'btc:a:native', symbol: 'BTC', amount: dec('0.5'), priceUsd: dec(btcPrice) },
      ...(ethFails ? [] : [{ sourceRef: 'eth:b:native', symbol: 'ETH', amount: dec('2'), priceUsd: dec('2000') }]),
    ],
    failures: ethFails ? [{ sourceRef: 'eth:b:native', reason: 'rpc down' }] : [],
  }),
})

const snap = (date: string, src: SourceType) => runSnapshot({ sources: [src], fx, now: new Date(`${date}T12:00:00Z`) })

describe('GET /api/dashboard', () => {
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
    await query('DELETE FROM "SnapshotLine"')
    await query('DELETE FROM "Snapshot"')
  })

  afterAll(async () => {
    await app.close()
    await pool.end()
  })

  const get = (url = '/api/dashboard', authed = true) => app.inject({ method: 'GET', url, cookies: authed ? cookies : {} })

  it('requires a session (SC1)', async () => {
    expect((await get('/api/dashboard', false)).statusCode).toBe(401)
  })

  it('returns an empty, valid shape with no snapshot (SC10)', async () => {
    const res = await get()
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ latest: null, change: { day: null, week: null }, series: [], breakdown: null })
  })

  it('returns totals and no change figures with a single snapshot (SC10)', async () => {
    await snap('2026-11-19', source('60000'))
    const body = (await get()).json()
    // 0.5 * 60000 + 2 * 2000 = 34000 USD, 27200 EUR at 1.25
    expect(body.latest).toMatchObject({ date: '2026-11-19', totalUsd: '34000.00000000', totalEur: '27200.00000000', status: 'complete' })
    expect(body.change).toEqual({ day: null, week: null })
    expect(body.series).toHaveLength(1)
    expect(body.breakdown.lines.map((l: { symbol: string }) => l.symbol)).toEqual(['BTC', 'ETH']) // by value, largest first
  })

  it('names, categorises and gives a status to every line, so the client does not guess', async () => {
    await snap('2026-11-19', source('60000'))
    const [btc] = (await get()).json().breakdown.lines
    expect(btc).toMatchObject({ sourceType: 'crypto', sourceLabel: 'Crypto', category: 'crypto', categoryLabel: 'Crypto', status: 'available' })
  })

  it('computes 1-day and 7-day changes in decimal math from stored values (SC10)', async () => {
    await snap('2026-11-12', source('50000')) // 25000 + 4000 = 29000 USD
    await snap('2026-11-18', source('56000')) // 28000 + 4000 = 32000 USD
    await snap('2026-11-19', source('60000')) // 30000 + 4000 = 34000 USD
    const { change, series } = (await get()).json()

    expect(series.map((s: { date: string }) => s.date)).toEqual(['2026-11-12', '2026-11-18', '2026-11-19'])
    expect(change.day).toEqual({
      since: '2026-11-18',
      usd: { abs: '2000.00000000', pct: '6.25' },
      eur: { abs: '1600.00000000', pct: '6.25' },
    })
    // 34000 - 29000 = 5000, 5000 / 29000 = 17.2413...%
    expect(change.week).toEqual({
      since: '2026-11-12',
      usd: { abs: '5000.00000000', pct: '17.24' },
      eur: { abs: '4000.00000000', pct: '17.24' },
    })
  })

  it('gives no change when the comparison day has no snapshot, never a change over another period', async () => {
    await snap('2026-11-15', source('50000'))
    await snap('2026-11-19', source('60000'))
    expect((await get()).json().change).toEqual({ day: null, week: null })
  })

  it('marks partial snapshots and carries stale lines with staleSince', async () => {
    await snap('2026-11-18', source('60000'))
    await snap('2026-11-19', source('60000', true))
    const body = (await get()).json()
    expect(body.latest.status).toBe('partial')
    const eth = body.breakdown.lines.find((l: { symbol: string }) => l.symbol === 'ETH')
    expect(eth).toMatchObject({ stale: true, staleSince: '2026-11-18', valueUsd: '4000.00000000' })
    expect(body.series[1].status).toBe('partial')
  })

  it('returns the breakdown of a requested date, and 404 for a date with no snapshot', async () => {
    await snap('2026-11-18', source('56000'))
    await snap('2026-11-19', source('60000'))
    const old = (await get('/api/dashboard?date=2026-11-18')).json()
    expect(old.breakdown.date).toBe('2026-11-18')
    expect(old.breakdown.lines.find((l: { symbol: string }) => l.symbol === 'BTC').valueUsd).toBe('28000.00000000')
    expect(old.latest.date).toBe('2026-11-19') // totals and change stay anchored on the latest snapshot

    expect((await get('/api/dashboard?date=2026-01-01')).statusCode).toBe(404)
    expect((await get('/api/dashboard?date=nope')).statusCode).toBe(400)
  })

  it('reports a percentage of null when the earlier total was 0', async () => {
    await snap('2026-11-18', { id: 'crypto', collect: async () => ({ lines: [], failures: [] }) })
    await snap('2026-11-19', source('60000'))
    const { day } = (await get()).json().change
    expect(day.usd).toEqual({ abs: '34000.00000000', pct: null })
  })
})
