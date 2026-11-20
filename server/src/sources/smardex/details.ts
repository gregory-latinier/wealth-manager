import { Decimal, fixed, fromBaseUnits } from '../../lib/money'
import { createEthCall } from '../crypto/providers/evm-rpc'
import { createCoinGecko } from '../crypto/providers/coingecko'
import { createPriceProvider } from '../crypto/providers/defillama'
import type { PriceProvider } from '../crypto/providers/types'
import {
  PROTOCOL,
  WSTETH,
  WSTETH_DECIMALS,
  decodeInt256,
  decodeLongPosition,
  decodeUint,
  encodeGetEffectivePriceForTick,
  encodeGetLongPosition,
  encodeGetPositionValue,
  positionKey,
  type DiscoveredPosition,
  type PositionId,
} from './abi'
import { createBlockscoutHistory, type PositionHistory } from './discovery'
import { ownedBy, reasonOf, type EthCall } from './ownership'
import { pgStore, type SmardexStore } from './store'

export interface PositionDetail extends PositionId {
  /** ISO date of the opening, or null when the opening transaction was not found for this address. */
  openedAt: string | null
  /** wstETH put in. */
  collateral: string | null
  /** Collateral times leverage: the size of the trade, in wstETH. */
  size: string | null
  leverage: string | null
  /** USD price of one wstETH when the position was opened. Null when unknown. */
  entryPriceUsd: string | null
  /** USD price of one wstETH at which the position is liquidated. */
  liquidationPriceUsd: string | null
  /** What the position is worth now, in wstETH. Zero when under water. */
  valueWstEth: string | null
  valueUsd: string | null
  /** Profit or loss in wstETH (value minus collateral) and as a percentage of the collateral. */
  pnlWstEth: string | null
  pnlWstEthPct: string | null
  /** Profit or loss in USD (value now at today's price minus collateral at the entry price) and as a percentage. Null without an entry price. */
  pnlUsd: string | null
  pnlUsdPct: string | null
  /** Set when a read failed. The fields that could not be computed are null. */
  error: string | null
}

export interface WalletPositions {
  /** Current USD price of one wstETH, or null if it could not be read. */
  wstEthUsd: string | null
  positions: PositionDetail[]
  /** Problems that are not tied to one position, such as an unreadable transaction history. */
  warnings: string[]
}

export interface DetailsDeps {
  history: PositionHistory
  store: SmardexStore
  ethCall: EthCall
  prices: Pick<PriceProvider, 'getTokenPrices'>
  now?: () => number
}

const ETH_DECIMALS = 18
const WEI = new Decimal(10).pow(ETH_DECIMALS)
const pct = (part: Decimal, whole: Decimal) => (whole.isZero() ? null : fixed(part.div(whole).mul(100), 2))

const empty = (p: PositionId): PositionDetail => ({
  tick: p.tick,
  tickVersion: p.tickVersion,
  index: p.index,
  openedAt: null,
  collateral: null,
  size: null,
  leverage: null,
  entryPriceUsd: null,
  liquidationPriceUsd: null,
  valueWstEth: null,
  valueUsd: null,
  pnlWstEth: null,
  pnlWstEthPct: null,
  pnlUsd: null,
  pnlUsdPct: null,
  error: null,
})

export function createPositionDetails(deps: DetailsDeps) {
  const now = deps.now ?? Date.now
  // Positions cached before the opening data was stored have none. The history is re-read for them, but only once per
  // process: a position handed over by someone else has no opening event for this address and would trigger it every time.
  const reread = new Set<string>()

  return async function details(address: string): Promise<WalletPositions> {
    const warnings: string[] = []

    // 1. Candidates: the cache plus whatever is newer than its marker. Same logic as the snapshot source.
    const state = await deps.store.load(address)
    const candidates = new Map(state.positions.map((p) => [positionKey(p), p]))
    try {
      const found = await deps.history.findNew(address, state.lastTxHash)
      if (found.newest) {
        await deps.store.save(address, found.positions, found.newest)
        for (const p of found.positions) candidates.set(positionKey(p), { ...candidates.get(positionKey(p)), ...p })
      }
    } catch (err) {
      warnings.push(`Could not read the transaction history: ${reasonOf(err)}. Positions opened recently may be missing.`)
    }

    // 2. Which of them are open now.
    const open: DiscoveredPosition[] = []
    const failed: PositionDetail[] = []
    for (const p of candidates.values()) {
      try {
        const owned = await ownedBy(deps.ethCall, address, p)
        if (typeof owned === 'string') failed.push({ ...empty(p), error: owned })
        else if (owned) open.push(p)
      } catch (err) {
        failed.push({ ...empty(p), error: reasonOf(err) })
      }
    }

    // 3. Fill in the opening of positions that lack it by reading the whole history once.
    if (open.some((p) => p.entryPrice === undefined) && !reread.has(address)) {
      reread.add(address)
      try {
        const all = await deps.history.findNew(address, null)
        if (all.newest) {
          await deps.store.save(address, all.positions, all.newest)
          const byKey = new Map(all.positions.map((p) => [positionKey(p), p]))
          open.forEach((p, i) => {
            open[i] = { ...p, ...byKey.get(positionKey(p)) }
          })
        }
      } catch (err) {
        reread.delete(address) // try again on the next request
        warnings.push(`Could not read the opening of some positions: ${reasonOf(err)}.`)
      }
    }

    // 4. Current price, then the live reads for every open position.
    let wstEthUsd: Decimal | undefined
    try {
      wstEthUsd = (await deps.prices.getTokenPrices('eth', [WSTETH])).get(WSTETH)
      if (!wstEthUsd) warnings.push('The wstETH price could not be read, so dollar values are missing.')
    } catch (err) {
      warnings.push(`The wstETH price could not be read (${reasonOf(err)}), so dollar values are missing.`)
    }

    const timestamp = BigInt(Math.floor(now() / 1000))
    const price = wstEthUsd ? BigInt(wstEthUsd.mul(WEI).toFixed(0)) : undefined
    const read: PositionDetail[] = []

    if (open.length > 0) {
      // Up to three reads per position, in one batch. Without a price there is no value read, but the collateral and the
      // liquidation price are still shown.
      const stride = price === undefined ? 2 : 3
      const calls = open.flatMap((p) => [
        { to: PROTOCOL, data: encodeGetLongPosition(p) },
        { to: PROTOCOL, data: encodeGetEffectivePriceForTick(p.tick) },
        ...(price === undefined ? [] : [{ to: PROTOCOL, data: encodeGetPositionValue(p, price, timestamp) }]),
      ])
      let outcomes: Awaited<ReturnType<EthCall>>
      try {
        outcomes = await deps.ethCall(calls)
      } catch (err) {
        outcomes = calls.map(() => ({ ok: false as const, error: reasonOf(err) }))
      }

      open.forEach((p, i) => {
        const d = empty(p)
        const [position, liquidation, value] = [outcomes[i * stride], outcomes[i * stride + 1], outcomes[i * stride + 2]]
        const errors: string[] = []
        if (p.openedAt !== undefined) d.openedAt = new Date(p.openedAt * 1000).toISOString()
        const entry = p.entryPrice !== undefined ? fromBaseUnits(p.entryPrice, ETH_DECIMALS) : undefined
        if (entry) d.entryPriceUsd = fixed(entry, 2)

        let collateral: Decimal | undefined
        try {
          if (!position?.ok) throw new Error(position?.error ?? 'no result returned')
          const pos = decodeLongPosition(position.result)
          collateral = fromBaseUnits(pos.amount, WSTETH_DECIMALS)
          const size = fromBaseUnits(pos.totalExpo, WSTETH_DECIMALS)
          d.collateral = fixed(collateral, 6)
          d.size = fixed(size, 6)
          d.leverage = collateral.isZero() ? null : fixed(size.div(collateral), 2)
        } catch (err) {
          errors.push(`position: ${reasonOf(err)}`)
        }

        try {
          if (!liquidation?.ok) throw new Error(liquidation?.error ?? 'no result returned')
          d.liquidationPriceUsd = fixed(fromBaseUnits(decodeUint(liquidation.result), ETH_DECIMALS), 2)
        } catch (err) {
          errors.push(`liquidation price: ${reasonOf(err)}`)
        }

        if (price !== undefined && wstEthUsd) {
          try {
            if (!value?.ok) throw new Error(value?.error ?? 'no result returned')
            const raw = decodeInt256(value.result)
            // Under water counts as nothing, like in the snapshot: the position cannot lose more than its collateral.
            const worth = fromBaseUnits(raw > 0n ? raw : 0n, WSTETH_DECIMALS)
            d.valueWstEth = fixed(worth, 6)
            d.valueUsd = fixed(worth.mul(wstEthUsd), 2)
            if (collateral) {
              d.pnlWstEth = fixed(worth.sub(collateral), 6)
              d.pnlWstEthPct = pct(worth.sub(collateral), collateral)
              if (entry) {
                const cost = collateral.mul(entry)
                const gain = worth.mul(wstEthUsd).sub(cost)
                d.pnlUsd = fixed(gain, 2)
                d.pnlUsdPct = pct(gain, cost)
              }
            }
          } catch (err) {
            errors.push(`value: ${reasonOf(err)}`)
          }
        }

        d.error = errors.length > 0 ? errors.join('; ') : null
        read.push(d)
      })
    }

    // Oldest first when the date is known, so the page reads in the order the positions were opened.
    const all = [...read, ...failed].sort((a, b) => (a.openedAt ?? '').localeCompare(b.openedAt ?? '') || a.tick - b.tick)
    return { wstEthUsd: wstEthUsd ? fixed(wstEthUsd, 2) : null, positions: all, warnings }
  }
}

/** The details reader wired to the real providers. */
export function createDefaultPositionDetails() {
  return createPositionDetails({
    history: createBlockscoutHistory(),
    store: pgStore,
    ethCall: createEthCall('eth'),
    prices: createPriceProvider(createCoinGecko()),
  })
}
