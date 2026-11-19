import { pool, query } from '../../db/index'
import { dec } from '../../lib/money'
import { runSnapshot } from '../../lib/snapshot'
import type { FxProvider } from '../fx/frankfurter'
import { createAddress, updateAddress } from './addresses'
import { createCryptoSource, nativeRef, type CryptoProviders } from './index'
import { ProviderError, type BtcProvider, type EvmProvider, type PriceProvider } from './providers/types'

const EVM = '0xabcdef0123456789abcdef0123456789abcdef01'
const EVM_2 = '0x1111111111111111111111111111111111111111'
const BTC = '1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa'

const fx: FxProvider = { getUsdPerEur: async () => ({ usdPerEur: dec('1.25'), date: '2026-11-19' }) }

interface Fakes {
  btc: Record<string, string | Error>
  evm: Record<string, string | Error> // key: `${chain}:${address}`
  prices: { btc: string; eth: string } | Error
}

function fakeProviders(f: Fakes): CryptoProviders {
  const btc: BtcProvider = {
    getBalance: async (address) => {
      const v = f.btc[address]
      if (v === undefined) throw new Error(`unexpected btc address ${address}`)
      if (v instanceof Error) throw v
      return dec(v)
    },
  }
  const evm: EvmProvider = {
    getBalances: async (chain, address) => {
      const v = f.evm[`${chain}:${address}`]
      if (v === undefined) throw new Error(`unexpected evm address ${chain}:${address}`)
      if (v instanceof Error) throw v
      return { native: dec(v), tokens: {} }
    },
    getTokenMetadata: async () => {
      throw new Error('not used')
    },
  }
  const prices: PriceProvider = {
    getNativePrices: async () => {
      if (f.prices instanceof Error) throw f.prices
      return { btc: dec(f.prices.btc), eth: dec(f.prices.eth) }
    },
    getTokenPrices: async () => new Map(),
  }
  return { btc, evm, prices }
}

describe('crypto source (native coins)', () => {
  beforeEach(async () => {
    await query('DELETE FROM "CryptoAddress"')
    await query('DELETE FROM "SnapshotLine"')
    await query('DELETE FROM "Snapshot"')
  })

  afterAll(async () => {
    await pool.end()
  })

  it('has no lines and no failures without addresses', async () => {
    const source = createCryptoSource(fakeProviders({ btc: {}, evm: {}, prices: { btc: '1', eth: '1' } }))
    expect(await source.collect({ date: '2026-11-19' })).toEqual({ lines: [], failures: [] })
  })

  it('returns one line per active address with hand-computed amount and price', async () => {
    await createAddress({ chain: 'btc', address: BTC, label: null })
    await createAddress({ chain: 'eth', address: EVM, label: null })
    await createAddress({ chain: 'base', address: EVM, label: null })
    const source = createCryptoSource(
      fakeProviders({
        btc: { [BTC]: '1.5' },
        evm: { [`eth:${EVM}`]: '2', [`base:${EVM}`]: '0.25' },
        prices: { btc: '60000', eth: '2000' },
      })
    )

    const { lines, failures } = await source.collect({ date: '2026-11-19' })
    expect(failures).toEqual([])
    expect(
      lines.map((l) => ({ ref: l.sourceRef, symbol: l.symbol, amount: l.amount.toString(), price: l.priceUsd.toString() }))
    ).toEqual([
      { ref: nativeRef('base', EVM), symbol: 'ETH', amount: '0.25', price: '2000' },
      { ref: nativeRef('btc', BTC), symbol: 'BTC', amount: '1.5', price: '60000' },
      { ref: nativeRef('eth', EVM), symbol: 'ETH', amount: '2', price: '2000' },
    ])
  })

  it('skips paused addresses entirely, without calling the providers (SC6)', async () => {
    const paused = (await createAddress({ chain: 'eth', address: EVM, label: null }))!
    await createAddress({ chain: 'eth', address: EVM_2, label: null })
    await updateAddress(paused.id, { active: false })
    // EVM is not in the fakes: calling the provider for it would fail the test through a reported failure.
    const source = createCryptoSource(
      fakeProviders({ btc: {}, evm: { [`eth:${EVM_2}`]: '1' }, prices: { btc: '1', eth: '2000' } })
    )

    const { lines, failures } = await source.collect({ date: '2026-11-19' })
    expect(failures).toEqual([])
    expect(lines.map((l) => l.sourceRef)).toEqual([nativeRef('eth', EVM_2)])
  })

  it('reports a failing address in failures and still values the others (SC9)', async () => {
    await createAddress({ chain: 'btc', address: BTC, label: null })
    await createAddress({ chain: 'eth', address: EVM, label: null })
    const source = createCryptoSource(
      fakeProviders({
        btc: { [BTC]: new ProviderError('mempool.space', 'http', 'HTTP 429') },
        evm: { [`eth:${EVM}`]: '3' },
        prices: { btc: '60000', eth: '2000' },
      })
    )

    const { lines, failures } = await source.collect({ date: '2026-11-19' })
    expect(lines.map((l) => l.sourceRef)).toEqual([nativeRef('eth', EVM)])
    expect(failures).toEqual([{ sourceRef: nativeRef('btc', BTC), reason: 'mempool.space: HTTP 429' }])
  })

  it('fails every entry, and values none at 0, when prices are unavailable', async () => {
    await createAddress({ chain: 'btc', address: BTC, label: null })
    await createAddress({ chain: 'eth', address: EVM, label: null })
    const source = createCryptoSource(
      fakeProviders({
        btc: { [BTC]: '1' },
        evm: { [`eth:${EVM}`]: '1' },
        prices: new ProviderError('coingecko', 'http', 'HTTP 429'),
      })
    )

    const { lines, failures } = await source.collect({ date: '2026-11-19' })
    expect(lines).toEqual([])
    expect(failures.map((f) => f.sourceRef).sort()).toEqual([nativeRef('btc', BTC), nativeRef('eth', EVM)].sort())
    expect(failures[0].reason).toContain('price lookup failed')
  })

  it('runs through the engine: totals match, then a failing address is carried forward as stale (SC7, SC9)', async () => {
    await createAddress({ chain: 'btc', address: BTC, label: null })
    await createAddress({ chain: 'eth', address: EVM, label: null })

    const day1 = createCryptoSource(
      fakeProviders({ btc: { [BTC]: '0.5' }, evm: { [`eth:${EVM}`]: '2' }, prices: { btc: '60000', eth: '2000' } })
    )
    const first = await runSnapshot({ sources: [day1], fx, now: new Date('2026-11-19T12:00:00Z') })
    // 0.5 * 60000 + 2 * 2000 = 34000 USD; / 1.25 = 27200 EUR
    expect(first).toMatchObject({ status: 'complete', totalUsd: '34000.00000000', totalEur: '27200.00000000', lineCount: 2 })

    const day2 = createCryptoSource(
      fakeProviders({
        btc: { [BTC]: new ProviderError('mempool.space', 'timeout', 'no answer within 15000 ms') },
        evm: { [`eth:${EVM}`]: '3' },
        prices: { btc: '61000', eth: '2100' },
      })
    )
    const second = await runSnapshot({ sources: [day2], fx, now: new Date('2026-11-20T12:00:00Z') })
    // BTC carried forward at day 1 value (30000), ETH fresh: 3 * 2100 = 6300 -> 36300
    expect(second).toMatchObject({ status: 'partial', totalUsd: '36300.00000000', leftOut: [] })
    expect(second.stale).toEqual([{ sourceType: 'crypto', sourceRef: nativeRef('btc', BTC), staleSince: '2026-11-19' }])
  })
})
