import { dec } from '../../lib/money'
import { LONG_FARMING, PROTOCOL, SELECTORS, WSTETH, positionKey, type DiscoveredPosition } from './abi'
import { createPositionDetails, type DetailsDeps } from './details'
import type { PositionHistory } from './discovery'
import type { EthCall } from './ownership'
import type { ScanState, SmardexStore } from './store'

const ME = '0x806be92538e21d63eff9681f5b96dd4f52bfff31'
const ZERO = '0x' + '0'.repeat(40)
const ETH = 10n ** 18n
const word = (v: bigint) => (v & ((1n << 256n) - 1n)).toString(16).padStart(64, '0')
const addr = (a: string) => word(BigInt(a))

const OPEN = { tick: 64300, tickVersion: '0', index: '0' }
const CLOSED = { tick: 67300, tickVersion: '0', index: '0' }

interface Chain {
  /** Per position: owner, collateral, size, value (all wei), liquidation price (18 decimals). */
  positions: Record<string, { user: string; amount: bigint; totalExpo: bigint; value: bigint; liquidation: bigint }>
  broken?: Set<string>
}

const keyOf = (data: string) =>
  positionKey({
    tick: Number(BigInt.asIntN(256, BigInt('0x' + data.slice(10, 74)))),
    tickVersion: String(BigInt('0x' + data.slice(74, 138))),
    index: String(BigInt('0x' + data.slice(138, 202))),
  })

function fakeEthCall(chain: Chain, log: string[] = []): EthCall {
  return async (calls) =>
    calls.map((c) => {
      const selector = c.data.slice(0, 10)
      if (selector === SELECTORS.getEffectivePriceForTick) {
        log.push('liquidation')
        const tick = Number(BigInt.asIntN(256, BigInt('0x' + c.data.slice(10, 74))))
        const found = Object.entries(chain.positions).find(([k]) => k.startsWith(`${tick}:`))
        return found ? { ok: true as const, result: '0x' + word(found[1].liquidation) } : { ok: false as const, error: 'no tick' }
      }
      const key = keyOf(c.data)
      const p = chain.positions[key]
      if (chain.broken?.has(key) && selector === SELECTORS.getPositionValue) return { ok: false as const, error: 'rpc down' }
      if (selector === SELECTORS.getLongPosition) {
        log.push('position')
        return { ok: true as const, result: '0x' + word(1n) + word(1n) + addr(p?.user ?? ZERO) + word(p?.totalExpo ?? 0n) + word(p?.amount ?? 0n) + word(200n) }
      }
      if (selector === SELECTORS.getPositionInfo && c.to === LONG_FARMING) return { ok: true as const, result: '0x' + addr(ZERO) + word(0n) }
      if (selector === SELECTORS.getPositionValue && c.to === PROTOCOL) {
        log.push('value')
        return { ok: true as const, result: '0x' + word(p?.value ?? 0n) }
      }
      return { ok: false as const, error: 'unexpected call' }
    })
}

function memoryStore(positions: DiscoveredPosition[] = []): SmardexStore & { state: ScanState } {
  const store = {
    state: { lastTxHash: positions.length ? '0xtx' : null, positions } as ScanState,
    async load() {
      return { lastTxHash: store.state.lastTxHash, positions: [...store.state.positions] }
    },
    async save(_a: string, found: DiscoveredPosition[], lastTxHash: string) {
      const byKey = new Map(store.state.positions.map((p) => [positionKey(p), p]))
      for (const p of found) byKey.set(positionKey(p), { ...byKey.get(positionKey(p)), ...p })
      store.state = { lastTxHash, positions: [...byKey.values()] }
    },
  }
  return store
}

const noHistory: PositionHistory = { findNew: async () => ({ positions: [], newest: null }) }

const standard: Chain = {
  positions: {
    [positionKey(OPEN)]: { user: ME, amount: 10n * ETH, totalExpo: 12n * ETH, value: 8n * ETH, liquidation: 700n * ETH },
    [positionKey(CLOSED)]: { user: ZERO, amount: 0n, totalExpo: 0n, value: 0n, liquidation: 900n * ETH },
  },
}

const OPENED_AT = 1_738_000_000
const opened: DiscoveredPosition = { ...OPEN, openedAt: OPENED_AT, entryPrice: String(3000n * ETH) }

function build(overrides: Partial<DetailsDeps> = {}) {
  return createPositionDetails({
    history: noHistory,
    store: memoryStore([opened, CLOSED]),
    ethCall: fakeEthCall(standard),
    prices: { getTokenPrices: async () => new Map([[WSTETH, dec('2000')]]) },
    now: () => 1_700_000_000_000,
    ...overrides,
  })
}

describe('position details', () => {
  it('computes collateral, leverage, liquidation price and PnL for an open position, and skips a closed one', async () => {
    const res = await build()(ME)

    expect(res.warnings).toEqual([])
    expect(res.wstEthUsd).toBe('2000.00')
    expect(res.positions).toHaveLength(1)
    expect(res.positions[0]).toEqual({
      ...OPEN,
      openedAt: new Date(OPENED_AT * 1000).toISOString(),
      collateral: '10.000000',
      size: '12.000000',
      leverage: '1.20',
      entryPriceUsd: '3000.00',
      liquidationPriceUsd: '700.00',
      valueWstEth: '8.000000',
      valueUsd: '16000.00',
      // 8 - 10 wstETH.
      pnlWstEth: '-2.000000',
      pnlWstEthPct: '-20.00',
      // 8 x 2000 = 16 000 now against 10 x 3000 = 30 000 put in.
      pnlUsd: '-14000.00',
      pnlUsdPct: '-46.67',
      error: null,
    })
  })

  it('counts a position under water as worth nothing, not as a debt', async () => {
    const chain: Chain = { positions: { [positionKey(OPEN)]: { ...standard.positions[positionKey(OPEN)], value: -5n * ETH } } }
    const res = await build({ ethCall: fakeEthCall(chain) })(ME)
    expect(res.positions[0]).toMatchObject({ valueWstEth: '0.000000', valueUsd: '0.00', pnlWstEth: '-10.000000', pnlWstEthPct: '-100.00' })
  })

  it('shows what it can without an entry price, and leaves the dollar PnL empty rather than guessing', async () => {
    const res = await build({ store: memoryStore([{ ...OPEN }]), history: noHistory })(ME)
    expect(res.positions[0]).toMatchObject({ entryPriceUsd: null, openedAt: null, pnlUsd: null, pnlUsdPct: null, pnlWstEth: '-2.000000' })
  })

  it('re-reads the history once to fill in the opening of a position cached without it', async () => {
    let reads = 0
    const history: PositionHistory = {
      findNew: async (_a, since) => {
        reads++
        // Nothing is newer than the marker, but a full read (since = null) returns the opening.
        return since ? { positions: [], newest: null } : { positions: [opened], newest: '0xtx' }
      },
    }
    const details = build({ store: memoryStore([{ ...OPEN }]), history })
    const first = await details(ME)
    expect(first.positions[0].entryPriceUsd).toBe('3000.00')
    expect(first.positions[0].openedAt).toBe(new Date(OPENED_AT * 1000).toISOString())

    // A second request must not trigger another full read.
    const readsAfterFirst = reads
    await details(ME)
    expect(reads - readsAfterFirst).toBe(1) // only the incremental scan
  })

  it('still shows collateral and liquidation price when the price is unavailable, and says so', async () => {
    const res = await build({
      prices: {
        getTokenPrices: async () => {
          throw new Error('defillama down')
        },
      },
    })(ME)
    expect(res.wstEthUsd).toBeNull()
    expect(res.warnings.join(' ')).toContain('wstETH price could not be read')
    expect(res.positions[0]).toMatchObject({ collateral: '10.000000', liquidationPriceUsd: '700.00', valueWstEth: null, valueUsd: null, pnlWstEth: null })
  })

  it('reports a failed value read on the position instead of showing zero', async () => {
    const res = await build({ ethCall: fakeEthCall({ ...standard, broken: new Set([positionKey(OPEN)]) }) })(ME)
    expect(res.positions[0].valueWstEth).toBeNull()
    expect(res.positions[0].error).toContain('rpc down')
    expect(res.positions[0].collateral).toBe('10.000000')
  })

  it('warns when the history cannot be read, and still shows cached positions', async () => {
    const history: PositionHistory = {
      findNew: async () => {
        throw new Error('blockscout: HTTP 500')
      },
    }
    const res = await build({ history })(ME)
    expect(res.warnings[0]).toContain('Could not read the transaction history')
    expect(res.positions).toHaveLength(1)
  })

  it('lists a position whose ownership could not be checked as an error, not as closed', async () => {
    const ethCall: EthCall = async (calls) => calls.map(() => ({ ok: false as const, error: 'rpc down' }))
    const res = await build({ ethCall })(ME)
    expect(res.positions).toHaveLength(2)
    expect(res.positions.every((p) => p.error === 'rpc down')).toBe(true)
  })
})
