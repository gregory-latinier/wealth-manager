import { dec } from '../../lib/money'
import { keccakHex } from '../../lib/keccak'
import type { CallOutcome } from '../crypto/providers/evm-rpc'
import { createAaveSource, debtRef, supplyRef } from './index'
import { readWallet } from './spoke'

const WALLET = '0x806be92538e21d63eff9681f5b96dd4f52bfff31'
const OTHER = '0x2222222222222222222222222222222222222222'
const WETH = '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2'
const USDC = '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48'

const sel = (sig: string) => keccakHex(sig).slice(0, 10)
const word = (value: bigint) => value.toString(16).padStart(64, '0')
const addressWord = (address: string) => address.replace(/^0x/, '').padStart(64, '0')
const MAX = (1n << 256n) - 1n

interface Reserve {
  underlying: string
  decimals: number
  supplied?: bigint
  debt?: bigint
}

/** A Spoke answering by selector. Reserve ids are the indexes of the list. */
const spoke = (reserves: Reserve[], opts: { health?: bigint; broken?: Set<number>; down?: boolean } = {}) => async (calls: Array<{ to: string; data: string }>): Promise<CallOutcome[]> => {
  if (opts.down) throw new Error('rpc down')
  return calls.map((c): CallOutcome => {
    const selector = c.data.slice(0, 10)
    const args = c.data.slice(10)
    const id = Number(BigInt('0x' + (args.slice(0, 64) || '0')))
    if (selector === sel('getReserveCount()')) return { ok: true, result: '0x' + word(BigInt(reserves.length)) }
    if (selector === sel('getUserAccountData(address)')) {
      const health = opts.health ?? MAX
      return { ok: true, result: '0x' + [0n, 840000000000000000n, health, 0n, 0n, 1n, 1n].map(word).join('') }
    }
    if (opts.broken?.has(id)) return { ok: false, error: 'execution reverted' }
    const r = reserves[id]
    if (!r) return { ok: false, error: 'bad reserve' }
    if (selector === sel('getUserSuppliedAssets(uint256,address)')) return { ok: true, result: '0x' + word(r.supplied ?? 0n) }
    if (selector === sel('getUserTotalDebt(uint256,address)')) return { ok: true, result: '0x' + word(r.debt ?? 0n) }
    if (selector === sel('getReserve(uint256)')) {
      return { ok: true, result: '0x' + [BigInt(r.underlying), 1n, 0n, BigInt(r.decimals), 0n, 12n, 0n].map(word).join('') }
    }
    return { ok: false, error: 'unknown selector' }
  })
}

const evm = {
  getTokenMetadata: async (_chain: 'eth' | 'base' | 'bsc', contract: string) =>
    contract === WETH ? { symbol: 'WETH', decimals: 18 } : { symbol: 'USDC', decimals: 6 },
}

// Reserve 0 is ETH collateral, 7 is USDC, like the user's real Spoke. The others hold nothing.
const empty: Reserve = { underlying: OTHER, decimals: 18 }
const reserves = (over: { eth?: Partial<Reserve>; usdc?: Partial<Reserve> } = {}): Reserve[] => [
  { underlying: WETH, decimals: 18, supplied: 3507495418464252825n, ...over.eth },
  empty,
  empty,
  empty,
  empty,
  empty,
  empty,
  { underlying: USDC, decimals: 6, debt: 4330662934n, ...over.usdc },
]

const PRICES = new Map([
  [WETH, dec('1727.28')],
  [USDC, dec('0.9999')],
])

const build = (opts: Parameters<typeof spoke>[1] = {}, prices: Map<string, ReturnType<typeof dec>> | Error = PRICES, previous: string[] = [], list = reserves()) =>
  createAaveSource({
    addresses: async () => [WALLET],
    previousRefs: async () => previous,
    ethCall: spoke(list, opts),
    evm,
    prices: {
      getTokenPrices: async () => {
        if (prices instanceof Error) throw prices
        return prices
      },
    },
  })

const ctx = { date: '2026-11-20' }

describe('aave source', () => {
  it('reports the collateral as a positive line and the borrow as a negative one', async () => {
    const res = await build().collect(ctx)
    expect(res.failures).toEqual([])
    expect(res.lines.map((l) => [l.sourceRef, l.symbol, l.amount.toString()])).toEqual([
      [supplyRef(WALLET, 0), 'WETH', '3.507495418464252825'],
      [debtRef(WALLET, 7), 'USDC', '-4330.662934'],
    ])
    expect(res.lines[0]!.priceUsd.toString()).toBe('1727.28')
    // The engine multiplies amount by price, so a negative amount is a negative value.
    expect(res.lines[1]!.amount.mul(res.lines[1]!.priceUsd).isNegative()).toBe(true)
  })

  it('has no line for a reserve the wallet does not use', async () => {
    const res = await build({}, PRICES, [], reserves({ eth: { supplied: 0n } })).collect(ctx)
    expect(res.lines.map((l) => l.sourceRef)).toEqual([debtRef(WALLET, 7)])
  })

  it('returns nothing when no wallet is tracked, without touching the chain', async () => {
    let called = false
    const source = createAaveSource({
      addresses: async () => [],
      ethCall: async () => {
        called = true
        return []
      },
      prices: { getTokenPrices: async () => new Map() },
    })
    expect(await source.collect(ctx)).toEqual({ lines: [], failures: [] })
    expect(called).toBe(false)
  })

  it('fails a priced-out reserve instead of valuing it at 0', async () => {
    const res = await build({}, new Map([[WETH, dec('1727.28')]])).collect(ctx)
    expect(res.lines.map((l) => l.sourceRef)).toEqual([supplyRef(WALLET, 0)])
    expect(res.failures).toEqual([{ sourceRef: debtRef(WALLET, 7), reason: 'no USD price for USDC' }])
  })

  it('fails both lines when the price lookup throws, so they are carried forward', async () => {
    const res = await build({}, new Error('defillama down')).collect(ctx)
    expect(res.lines).toEqual([])
    expect(res.failures.map((f) => f.sourceRef)).toEqual([supplyRef(WALLET, 0), debtRef(WALLET, 7)])
    expect(res.failures[0]!.reason).toContain('defillama down')
  })

  it('reports every earlier line as a failure when the wallet cannot be read, so the debt is not dropped', async () => {
    const previous = [supplyRef(WALLET, 0), debtRef(WALLET, 7)]
    const res = await build({ down: true }, PRICES, previous).collect(ctx)
    expect(res.lines).toEqual([])
    expect(res.failures.map((f) => f.sourceRef)).toEqual(previous)
    expect(res.failures[0]!.reason).toContain('rpc down')
  })

  it('still reports a failure for a wallet that was never snapshotted and cannot be read', async () => {
    const res = await build({ down: true }).collect(ctx)
    expect(res.failures).toEqual([{ sourceRef: `${WALLET}:*`, reason: expect.stringContaining('rpc down') }])
  })

  it('fails only the reserve that cannot be read', async () => {
    const res = await build({ broken: new Set([7]) }).collect(ctx)
    expect(res.lines.map((l) => l.sourceRef)).toEqual([supplyRef(WALLET, 0)])
    expect(res.failures.map((f) => f.sourceRef)).toEqual([debtRef(WALLET, 7), supplyRef(WALLET, 7)])
  })
})

describe('readWallet', () => {
  it('reads the health factor and ignores the no-debt marker', async () => {
    const read = await readWallet(spoke(reserves(), { health: 1178941230857609940n }), evm, WALLET)
    expect(read.healthFactor?.toFixed(4)).toBe('1.1789')
    expect((await readWallet(spoke(reserves()), evm, WALLET)).healthFactor).toBeNull()
  })

  it('refuses an address that is not a Spoke', async () => {
    await expect(readWallet(async () => [{ ok: true, result: '0x' }], evm, WALLET)).rejects.toThrow('getReserveCount()')
  })

  it('refuses a Spoke that fails to answer', async () => {
    await expect(readWallet(async () => [{ ok: false, error: 'execution reverted' }], evm, WALLET)).rejects.toThrow('execution reverted')
  })

  it('addresses the wallet in the call data', async () => {
    const seen: string[] = []
    const inner = spoke(reserves())
    await readWallet(async (calls) => {
      seen.push(...calls.map((c) => c.data))
      return inner(calls)
    }, evm, WALLET)
    expect(seen.some((d) => d.endsWith(addressWord(WALLET)))).toBe(true)
  })
})
