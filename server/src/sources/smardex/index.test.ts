import { dec } from '../../lib/money'
import { LONG_FARMING, PROTOCOL, SELECTORS, positionKey, type PositionId } from './abi'
import type { PositionHistory } from './discovery'
import { createSmardexSource, positionRef, type SmardexDeps } from './index'
import type { EthCall } from './ownership'
import type { ScanState, SmardexStore } from './store'

const ME = '0x806be92538e21d63eff9681f5b96dd4f52bfff31'
const OTHER = '0x1111111111111111111111111111111111111111'
const ZERO = '0x' + '0'.repeat(40)
const word = (v: bigint) => (v & ((1n << 256n) - 1n)).toString(16).padStart(64, '0')
const addr = (a: string) => word(BigInt(a))

const OPEN: PositionId = { tick: 64300, tickVersion: '0', index: '0' }
const CLOSED: PositionId = { tick: 67300, tickVersion: '0', index: '0' }
const FARMED: PositionId = { tick: 70000, tickVersion: '0', index: '1' }
const FOREIGN: PositionId = { tick: 71000, tickVersion: '0', index: '0' }

/** getLongPosition answer: validated, timestamp, user, totalExpo, amount, penalty. */
const positionResult = (user: string) => '0x' + word(1n) + word(1n) + addr(user) + word(1n) + word(1n) + word(1n)

interface Chain {
  /** Protocol owner per position. */
  users: Record<string, string>
  /** LongFarming owner per position. */
  farmed: Record<string, string>
  /** Value in wei per position. */
  values: Record<string, bigint>
  /** Positions whose reads fail. */
  broken?: Set<string>
}

function fakeEthCall(chain: Chain, seen: { valueCalls: number } = { valueCalls: 0 }): EthCall {
  return async (calls) =>
    calls.map((c) => {
      // Every call starts with a selector followed by the position id words: tick, version, index.
      const tick = Number(BigInt.asIntN(256, BigInt('0x' + c.data.slice(10, 74))))
      const key = positionKey({ tick, tickVersion: String(BigInt('0x' + c.data.slice(74, 138))), index: String(BigInt('0x' + c.data.slice(138, 202))) })
      if (chain.broken?.has(key)) return { ok: false as const, error: 'rpc down' }
      if (c.data.startsWith(SELECTORS.getLongPosition) && c.to === PROTOCOL) {
        return { ok: true as const, result: positionResult(chain.users[key] ?? ZERO) }
      }
      if (c.data.startsWith(SELECTORS.getPositionInfo) && c.to === LONG_FARMING) {
        return { ok: true as const, result: '0x' + addr(chain.farmed[key] ?? ZERO) + word(0n) }
      }
      if (c.data.startsWith(SELECTORS.getPositionValue)) {
        seen.valueCalls++
        return { ok: true as const, result: '0x' + word(chain.values[key] ?? 0n) }
      }
      return { ok: false as const, error: 'unexpected call' }
    })
}

function memoryStore(initial?: ScanState): SmardexStore & { state: ScanState } {
  const store = {
    state: initial ?? { lastTxHash: null, positions: [] },
    async load() {
      return { lastTxHash: store.state.lastTxHash, positions: [...store.state.positions] }
    },
    async save(_a: string, positions: PositionId[], lastTxHash: string) {
      // Ids only: this suite does not look at the opening data.
      const known = new Set(store.state.positions.map(positionKey))
      store.state = { lastTxHash, positions: [...store.state.positions, ...positions.filter((p) => !known.has(positionKey(p)))] }
    },
  }
  return store
}

const history = (found: PositionId[], newest: string | null = '0xtx'): PositionHistory => ({ findNew: async () => ({ positions: found, newest }) })
const failingHistory: PositionHistory = {
  findNew: async () => {
    throw new Error('blockscout: HTTP 500')
  },
}

function build(overrides: Partial<SmardexDeps> & { chain: Chain }) {
  const { chain, ...rest } = overrides
  return createSmardexSource({
    history: history([]),
    store: memoryStore(),
    ethCall: fakeEthCall(chain),
    prices: { getTokenPrices: async () => new Map([['0x7f39c581f595b53c5cb19bd0b3f8da6c935e2ca0', dec('2000')]]) },
    addresses: async () => [ME],
    now: () => 1_700_000_000_000,
    ...rest,
  })
}

const ctx = { date: '2026-11-20' }
const ETH = 10n ** 18n

describe('smardex source', () => {
  it('values open positions in wstETH at the wstETH price and skips closed ones', async () => {
    const chain: Chain = {
      users: { [positionKey(OPEN)]: ME, [positionKey(CLOSED)]: ZERO },
      farmed: {},
      values: { [positionKey(OPEN)]: 5n * ETH, [positionKey(CLOSED)]: 0n },
    }
    const res = await build({ chain, history: history([OPEN, CLOSED]) }).collect(ctx)

    expect(res.failures).toEqual([])
    expect(res.lines).toHaveLength(1)
    expect(res.lines[0].sourceRef).toBe(positionRef(ME, OPEN))
    expect(res.lines[0].symbol).toBe('wstETH')
    expect(res.lines[0].amount.toString()).toBe('5')
    expect(res.lines[0].priceUsd.toString()).toBe('2000')
  })

  it('counts a position parked in LongFarming for its real owner, and not for anyone else', async () => {
    const chain: Chain = {
      users: { [positionKey(FARMED)]: LONG_FARMING, [positionKey(FOREIGN)]: LONG_FARMING },
      farmed: { [positionKey(FARMED)]: ME, [positionKey(FOREIGN)]: OTHER },
      values: { [positionKey(FARMED)]: 2n * ETH, [positionKey(FOREIGN)]: 9n * ETH },
    }
    const res = await build({ chain, history: history([FARMED, FOREIGN]) }).collect(ctx)

    expect(res.lines.map((l) => l.sourceRef)).toEqual([positionRef(ME, FARMED)])
    expect(res.failures).toEqual([])
  })

  it('does not count a position that now belongs to someone else', async () => {
    const chain: Chain = { users: { [positionKey(OPEN)]: OTHER }, farmed: {}, values: { [positionKey(OPEN)]: 5n * ETH } }
    const res = await build({ chain, history: history([OPEN]) }).collect(ctx)
    expect(res.lines).toEqual([])
    expect(res.failures).toEqual([])
  })

  it('values an under-water position at 0 rather than as a debt', async () => {
    const chain: Chain = { users: { [positionKey(OPEN)]: ME }, farmed: {}, values: { [positionKey(OPEN)]: -3n * ETH } }
    const res = await build({ chain, history: history([OPEN]) }).collect(ctx)
    expect(res.lines[0].amount.toString()).toBe('0')
  })

  it('reports a position whose read fails instead of valuing it at 0', async () => {
    const chain: Chain = {
      users: { [positionKey(OPEN)]: ME },
      farmed: {},
      values: { [positionKey(OPEN)]: ETH },
      broken: new Set([positionKey(OPEN)]),
    }
    const res = await build({ chain, history: history([OPEN]) }).collect(ctx)
    expect(res.lines).toEqual([])
    expect(res.failures).toEqual([{ sourceRef: positionRef(ME, OPEN), reason: 'rpc down' }])
  })

  it('fails every open position, and prices none, when the wstETH price is unavailable', async () => {
    const chain: Chain = { users: { [positionKey(OPEN)]: ME }, farmed: {}, values: { [positionKey(OPEN)]: ETH } }
    const seen = { valueCalls: 0 }
    const res = await build({
      chain,
      history: history([OPEN]),
      ethCall: fakeEthCall(chain, seen),
      prices: {
        getTokenPrices: async () => {
          throw new Error('llama down')
        },
      },
    }).collect(ctx)

    expect(res.lines).toEqual([])
    expect(res.failures).toHaveLength(1)
    expect(res.failures[0].sourceRef).toBe(positionRef(ME, OPEN))
    expect(res.failures[0].reason).toContain('price lookup failed')
    expect(seen.valueCalls).toBe(0)
  })

  it('treats a price map without wstETH as a failure, not a price of 0', async () => {
    const chain: Chain = { users: { [positionKey(OPEN)]: ME }, farmed: {}, values: { [positionKey(OPEN)]: ETH } }
    const res = await build({ chain, history: history([OPEN]), prices: { getTokenPrices: async () => new Map() } }).collect(ctx)
    expect(res.lines).toEqual([])
    expect(res.failures[0].reason).toContain('no price')
  })

  it('still values cached positions when the history scan fails, and flags the scan', async () => {
    const chain: Chain = { users: { [positionKey(OPEN)]: ME }, farmed: {}, values: { [positionKey(OPEN)]: ETH } }
    const store = memoryStore({ lastTxHash: '0xold', positions: [OPEN] })
    const res = await build({ chain, store, history: failingHistory }).collect(ctx)

    expect(res.lines).toHaveLength(1)
    expect(res.failures).toEqual([{ sourceRef: `${ME}:scan`, reason: expect.stringContaining('HTTP 500') }])
    // The marker did not move, so the next run reads the same transactions again.
    expect(store.state.lastTxHash).toBe('0xold')
  })

  it('stores what a scan found and moves the marker, so the next run starts from there', async () => {
    const chain: Chain = { users: { [positionKey(OPEN)]: ME }, farmed: {}, values: { [positionKey(OPEN)]: ETH } }
    const store = memoryStore()
    await build({ chain, store, history: history([OPEN], '0xnewest') }).collect(ctx)
    expect(store.state).toEqual({ lastTxHash: '0xnewest', positions: [OPEN] })
  })

  it('does not move the marker when the address has no transactions', async () => {
    const chain: Chain = { users: {}, farmed: {}, values: {} }
    const store = memoryStore()
    await build({ chain, store, history: history([], null) }).collect(ctx)
    expect(store.state.lastTxHash).toBeNull()
  })

  it('returns nothing, and reads nothing, when there is no Ethereum address', async () => {
    const chain: Chain = { users: {}, farmed: {}, values: {} }
    const res = await build({
      chain,
      addresses: async () => [],
      history: { findNew: async () => { throw new Error('must not be called') } },
    }).collect(ctx)
    expect(res).toEqual({ lines: [], failures: [] })
  })

  it('keeps one address failing from hiding another', async () => {
    const chain: Chain = { users: { [positionKey(OPEN)]: OTHER }, farmed: {}, values: { [positionKey(OPEN)]: ETH } }
    const stores = new Map<string, ReturnType<typeof memoryStore>>()
    const res = await build({
      chain,
      addresses: async () => [ME, OTHER],
      store: {
        load: async (a) => {
          if (!stores.has(a)) stores.set(a, memoryStore())
          return stores.get(a)!.load()
        },
        save: async (a, p, h) => stores.get(a)!.save(a, p, h),
      },
      history: {
        findNew: async (a) => {
          if (a === ME) throw new Error('boom')
          return { positions: [OPEN], newest: '0xtx' }
        },
      },
    }).collect(ctx)

    expect(res.lines.map((l) => l.sourceRef)).toEqual([positionRef(OTHER, OPEN)])
    expect(res.failures.map((f) => f.sourceRef)).toEqual([`${ME}:scan`])
  })
})
