import { dec } from '../../lib/money'
import { ProviderError } from '../crypto/providers/types'
import { GMT_CONTRACT, createGominingSource, type GominingDeps } from './index'
import type { Miner } from './miners'
import type { GominingSettings } from './settings'

const miner = (over: Partial<Miner> = {}): Miner => ({ id: 'gm1', name: 'Miner', th: '10', active: true, createdAt: '2026-11-20T00:00:00Z', ...over })
const settings = (over: Partial<GominingSettings> = {}): GominingSettings => ({ thPrice: '20', thCurrency: 'USD', btc: '0', gmt: '0', ...over })
const RATE = dec('1.25')

const build = (miners: Miner[], s: GominingSettings, prices: Partial<GominingDeps['prices']> = {}) =>
  createGominingSource({
    miners: async () => miners,
    settings: async () => s,
    prices: {
      getNativePrices: async () => ({ btc: dec('90000'), eth: dec('3000') }),
      getTokenPrices: async () => new Map([[GMT_CONTRACT, dec('0.02')]]),
      ...prices,
    },
  })

describe('gomining source', () => {
  it('values a miner at its TH times the value of one TH, in USD', async () => {
    const res = await build([miner()], settings()).collect({ date: '2026-11-23' })
    expect(res.failures).toEqual([])
    expect(res.lines.map((l) => [l.sourceRef, l.symbol, l.amount.toString(), l.priceUsd.toString()])).toEqual([['gm1:TH', 'TH', '10', '20']])
  })

  it('converts a value per TH set in EUR with the rate the engine uses', async () => {
    const res = await build([miner()], settings({ thCurrency: 'EUR' })).collect({ date: '2026-11-23', usdPerEur: RATE })
    expect(res.lines.map((l) => l.priceUsd.toString())).toEqual(['25'])
  })

  it('fails every miner when the EUR rate is unavailable, never values it at 0', async () => {
    const res = await build([miner(), miner({ id: 'gm2' })], settings({ thCurrency: 'EUR' })).collect({ date: '2026-11-23' })
    expect(res.lines).toEqual([])
    expect(res.failures.map((f) => f.sourceRef)).toEqual(['gm1:TH', 'gm2:TH'])
    expect(res.failures[0]!.reason).toContain('rate')
  })

  it('fails the miners while the value per TH is not set', async () => {
    const res = await build([miner()], settings({ thPrice: null })).collect({ date: '2026-11-23' })
    expect(res.lines).toEqual([])
    expect(res.failures).toEqual([{ sourceRef: 'gm1:TH', reason: expect.stringContaining('not set') }])
  })

  it('prices the wallet BTC with the native price and the GMT by its contract', async () => {
    const res = await build([], settings({ btc: '0.5', gmt: '1000' })).collect({ date: '2026-11-23' })
    expect(res.failures).toEqual([])
    expect(res.lines.map((l) => [l.sourceRef, l.symbol, l.amount.toString(), l.priceUsd.toString()])).toEqual([
      ['wallet:BTC', 'BTC', '0.5', '90000'],
      ['wallet:GMT', 'GMT', '1000', '0.02'],
    ])
  })

  it('adds no line, and asks for no price, for an empty wallet', async () => {
    let asked = 0
    const res = await build([], settings(), {
      getNativePrices: async () => {
        asked++
        throw new ProviderError('coingecko', 'network', 'down')
      },
    }).collect({ date: '2026-11-23' })
    expect(res).toEqual({ lines: [], failures: [] })
    expect(asked).toBe(0)
  })

  it('fails the BTC when its price cannot be read, but still values the GMT', async () => {
    const res = await build([], settings({ btc: '1', gmt: '10' }), {
      getNativePrices: async () => {
        throw new ProviderError('coingecko', 'network', 'connection refused')
      },
    }).collect({ date: '2026-11-23' })
    expect(res.lines.map((l) => l.sourceRef)).toEqual(['wallet:GMT'])
    expect(res.failures).toEqual([{ sourceRef: 'wallet:BTC', reason: expect.stringContaining('connection refused') }])
  })

  it('fails the GMT when no provider knows its price, never values it at 0', async () => {
    const res = await build([], settings({ gmt: '10' }), { getTokenPrices: async () => new Map() }).collect({ date: '2026-11-23' })
    expect(res.lines).toEqual([])
    expect(res.failures).toEqual([{ sourceRef: 'wallet:GMT', reason: expect.stringContaining('GMT') }])
  })

  it('fails the GMT when the price lookup throws, but keeps the miners', async () => {
    const res = await build([miner()], settings({ gmt: '10' }), {
      getTokenPrices: async () => {
        throw new ProviderError('defillama', 'network', 'timeout')
      },
    }).collect({ date: '2026-11-23' })
    expect(res.lines.map((l) => l.sourceRef)).toEqual(['gm1:TH'])
    expect(res.failures.map((f) => f.sourceRef)).toEqual(['wallet:GMT'])
  })
})
