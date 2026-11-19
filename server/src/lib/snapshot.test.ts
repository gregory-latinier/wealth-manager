import { pool, query } from '../db/index'
import { dec } from './money'
import { NoRateError, runSnapshot } from './snapshot'
import type { FxProvider } from '../sources/fx/frankfurter'
import type { CollectResult, HoldingLine, SourceType } from '../sources/types'

const RATE = { usdPerEur: dec('1.25'), date: '2026-11-19' }
const fxOk: FxProvider = { getUsdPerEur: async () => RATE }
const fxDown: FxProvider = {
  getUsdPerEur: async () => {
    throw new Error('frankfurter down')
  },
}

const btc: HoldingLine = { sourceRef: 'btc:addr1:native', symbol: 'BTC', amount: dec('0.5'), priceUsd: dec('60000') }
const eth: HoldingLine = { sourceRef: 'eth:addr2:native', symbol: 'ETH', amount: dec('2'), priceUsd: dec('2500.5') }

function source(id: string, result: CollectResult | (() => CollectResult)): SourceType {
  return {
    id,
    collect: async () => {
      if (typeof result === 'function') return result()
      return result
    },
  }
}

const at = (iso: string) => new Date(`${iso}T12:00:00Z`)

async function lines(date: string) {
  const res = await query(
    `SELECT l.* FROM "SnapshotLine" l JOIN "Snapshot" s ON s."id" = l."snapshotId"
      WHERE s."date" = $1 ORDER BY l."sourceRef"`,
    [date]
  )
  return res.rows
}

describe('runSnapshot', () => {
  beforeEach(async () => {
    await query('DELETE FROM "SnapshotLine"')
    await query('DELETE FROM "Snapshot"')
  })

  afterAll(async () => {
    await pool.end()
  })

  it('stores totals and per-line values that match the hand-computed numbers (SC7)', async () => {
    const summary = await runSnapshot({
      sources: [source('crypto', { lines: [btc, eth], failures: [] })],
      fx: fxOk,
      now: at('2026-11-19'),
    })

    // 0.5 * 60000 = 30000 USD; 2 * 2500.5 = 5001 USD; / 1.25 = 24000 and 4000.8 EUR
    expect(summary).toMatchObject({
      date: '2026-11-19',
      status: 'complete',
      usdPerEur: '1.25',
      rateStale: false,
      totalUsd: '35001.00000000',
      totalEur: '28000.80000000',
      lineCount: 2,
      stale: [],
      leftOut: [],
    })

    const stored = await lines('2026-11-19')
    expect(stored.map((l) => [l.sourceRef, l.valueUsd, l.valueEur])).toEqual([
      ['btc:addr1:native', '30000.00000000', '24000.00000000'],
      ['eth:addr2:native', '5001.00000000', '4000.80000000'],
    ])
    const snap = await query('SELECT "date", "totalUsd", "totalEur", "rateDate" FROM "Snapshot"')
    expect(snap.rows[0]).toMatchObject({ date: '2026-11-19', totalUsd: '35001.00000000', totalEur: '28000.80000000' })
    expect(snap.rows[0].rateDate).toBe('2026-11-19')
  })

  it('a second run on the same UTC day leaves one snapshot with the second run values (SC8)', async () => {
    await runSnapshot({ sources: [source('crypto', { lines: [btc], failures: [] })], fx: fxOk, now: at('2026-11-19') })
    const second = await runSnapshot({
      sources: [source('crypto', { lines: [btc, eth], failures: [] })],
      fx: fxOk,
      now: new Date('2026-11-19T23:59:59Z'),
    })

    expect((await query('SELECT 1 FROM "Snapshot"')).rowCount).toBe(1)
    expect((await lines('2026-11-19')).length).toBe(2)
    expect(second.totalUsd).toBe('35001.00000000')
  })

  it('uses the UTC date, not the local one', async () => {
    const summary = await runSnapshot({
      sources: [source('crypto', { lines: [btc], failures: [] })],
      fx: fxOk,
      now: new Date('2026-11-19T23:30:00-05:00'), // 04:30 UTC on the 20th
    })
    expect(summary.date).toBe('2026-11-20')
  })

  it('carries a failed entry forward as stale, keeps its old values and marks the snapshot partial (SC9)', async () => {
    await runSnapshot({ sources: [source('crypto', { lines: [btc, eth], failures: [] })], fx: fxOk, now: at('2026-11-19') })

    const summary = await runSnapshot({
      sources: [
        source('crypto', {
          lines: [{ ...btc, priceUsd: dec('62000') }],
          failures: [{ sourceRef: eth.sourceRef, reason: 'rpc timeout' }],
        }),
      ],
      fx: fxOk,
      now: at('2026-11-20'),
    })

    expect(summary.status).toBe('partial')
    expect(summary.stale).toEqual([{ sourceType: 'crypto', sourceRef: eth.sourceRef, staleSince: '2026-11-19' }])
    // BTC 0.5 * 62000 = 31000 fresh, ETH 5001 carried forward unchanged
    expect(summary.totalUsd).toBe('36001.00000000')

    const stored = await lines('2026-11-20')
    const ethLine = stored.find((l) => l.sourceRef === eth.sourceRef)!
    expect(ethLine).toMatchObject({ stale: true, staleSince: '2026-11-19', valueUsd: '5001.00000000' })
    expect(stored.find((l) => l.sourceRef === btc.sourceRef)).toMatchObject({ stale: false, staleSince: null })
  })

  it('keeps the original staleSince while the entry keeps failing, and recomputes EUR with the current rate', async () => {
    await runSnapshot({ sources: [source('crypto', { lines: [eth], failures: [] })], fx: fxOk, now: at('2026-11-19') })
    const failing = source('crypto', { lines: [], failures: [{ sourceRef: eth.sourceRef, reason: 'down' }] })
    await runSnapshot({ sources: [failing], fx: fxOk, now: at('2026-11-20') })

    const newRate: FxProvider = { getUsdPerEur: async () => ({ usdPerEur: dec('1.0'), date: '2026-11-21' }) }
    const summary = await runSnapshot({ sources: [failing], fx: newRate, now: at('2026-11-21') })

    expect(summary.stale[0].staleSince).toBe('2026-11-19')
    const line = (await lines('2026-11-21'))[0]
    expect(line.valueUsd).toBe('5001.00000000')
    expect(line.valueEur).toBe('5001.00000000') // 5001 / 1.0, not the old 4000.8
  })

  it('leaves out a failed entry with no history and reports it, never valuing it at 0 (SC9)', async () => {
    const summary = await runSnapshot({
      sources: [source('crypto', { lines: [btc], failures: [{ sourceRef: 'eth:new:native', reason: 'no price' }] })],
      fx: fxOk,
      now: at('2026-11-19'),
    })

    expect(summary.status).toBe('partial')
    expect(summary.leftOut).toEqual([{ sourceType: 'crypto', sourceRef: 'eth:new:native', reason: 'no price' }])
    expect(summary.totalUsd).toBe('30000.00000000')
    expect((await lines('2026-11-19')).map((l) => l.sourceRef)).toEqual([btc.sourceRef])
  })

  it('reuses the last stored rate when the FX lookup fails and flags it (SC9)', async () => {
    await runSnapshot({ sources: [source('crypto', { lines: [btc], failures: [] })], fx: fxOk, now: at('2026-11-19') })
    const summary = await runSnapshot({
      sources: [source('crypto', { lines: [btc], failures: [] })],
      fx: fxDown,
      now: at('2026-11-20'),
    })

    expect(summary).toMatchObject({ rateStale: true, status: 'partial', usdPerEur: '1.25', totalEur: '24000.00000000' })
    const snap = await query(`SELECT "rateStale", "rateDate" FROM "Snapshot" WHERE "date" = '2026-11-20'`)
    expect(snap.rows[0]).toEqual({ rateStale: true, rateDate: '2026-11-19' })
  })

  it('writes no snapshot when the FX lookup fails and no rate was ever stored (SC9)', async () => {
    await expect(
      runSnapshot({ sources: [source('crypto', { lines: [btc], failures: [] })], fx: fxDown, now: at('2026-11-19') })
    ).rejects.toBeInstanceOf(NoRateError)
    expect((await query('SELECT 1 FROM "Snapshot"')).rowCount).toBe(0)
  })

  it('a later successful run on the same day clears stale lines and the stale rate (SC9)', async () => {
    await runSnapshot({ sources: [source('crypto', { lines: [btc, eth], failures: [] })], fx: fxOk, now: at('2026-11-19') })
    const bad = await runSnapshot({
      sources: [source('crypto', { lines: [btc], failures: [{ sourceRef: eth.sourceRef, reason: 'down' }] })],
      fx: fxDown,
      now: at('2026-11-20'),
    })
    expect(bad).toMatchObject({ status: 'partial', rateStale: true })

    const good = await runSnapshot({
      sources: [source('crypto', { lines: [btc, eth], failures: [] })],
      fx: fxOk,
      now: new Date('2026-11-20T18:00:00Z'),
    })
    expect(good).toMatchObject({ status: 'complete', rateStale: false, stale: [], leftOut: [] })
    expect((await lines('2026-11-20')).every((l) => l.stale === false && l.staleSince === null)).toBe(true)
    expect((await query('SELECT 1 FROM "Snapshot"')).rowCount).toBe(2)
  })

  it('includes a second source type in the totals with no engine change (SC11)', async () => {
    const forex = source('forex', {
      lines: [{ sourceRef: 'usd-account', symbol: 'USD', amount: dec('1000'), priceUsd: dec('1') }],
      failures: [],
    })
    const summary = await runSnapshot({
      sources: [source('crypto', { lines: [btc], failures: [] }), forex],
      fx: fxOk,
      now: at('2026-11-19'),
    })

    expect(summary.totalUsd).toBe('31000.00000000')
    expect(summary.totalEur).toBe('24800.00000000')
    const types = (await query(`SELECT DISTINCT "sourceType" FROM "SnapshotLine" ORDER BY 1`)).rows.map((r) => r.sourceType)
    expect(types).toEqual(['crypto', 'forex'])
  })

  it('carries forward a whole source that throws, using its last known lines', async () => {
    const broken: SourceType = {
      id: 'crypto',
      collect: async () => {
        throw new Error('database of doom')
      },
    }
    await runSnapshot({ sources: [source('crypto', { lines: [btc, eth], failures: [] })], fx: fxOk, now: at('2026-11-19') })
    const summary = await runSnapshot({ sources: [broken], fx: fxOk, now: at('2026-11-20') })

    expect(summary.status).toBe('partial')
    expect(summary.stale.map((s) => s.sourceRef).sort()).toEqual([btc.sourceRef, eth.sourceRef])
    expect(summary.totalUsd).toBe('35001.00000000')
  })

  it('reports a source that throws on its very first run instead of writing zeros', async () => {
    const broken: SourceType = {
      id: 'crypto',
      collect: async () => {
        throw new Error('boom')
      },
    }
    const summary = await runSnapshot({ sources: [broken], fx: fxOk, now: at('2026-11-19') })
    expect(summary.leftOut).toEqual([{ sourceType: 'crypto', sourceRef: '*', reason: 'source failed: boom' }])
    expect(summary.lineCount).toBe(0)
    expect(summary.status).toBe('partial')
  })

  it('keeps concurrent runs for the same day consistent (one snapshot row)', async () => {
    const src = () => source('crypto', { lines: [btc, eth], failures: [] })
    const results = await Promise.allSettled([
      runSnapshot({ sources: [src()], fx: fxOk, now: at('2026-11-19') }),
      runSnapshot({ sources: [src()], fx: fxOk, now: at('2026-11-19') }),
    ])
    expect(results.every((r) => r.status === 'fulfilled')).toBe(true)
    expect((await query('SELECT 1 FROM "Snapshot"')).rowCount).toBe(1)
    expect((await lines('2026-11-19')).length).toBe(2)
  })
})
