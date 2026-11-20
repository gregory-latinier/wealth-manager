import { Decimal, fromBaseUnits } from '../../lib/money'
import type { CollectResult, HoldingFailure, HoldingLine, SourceType } from '../types'
import { createEthCall, type CallOutcome } from '../crypto/providers/evm-rpc'
import { createCoinGecko } from '../crypto/providers/coingecko'
import { createPriceProvider } from '../crypto/providers/defillama'
import type { PriceProvider } from '../crypto/providers/types'
import { PROTOCOL, WSTETH, WSTETH_DECIMALS, decodeInt256, encodeGetPositionValue, positionKey, type PositionId } from './abi'
import { createBlockscoutHistory, type PositionHistory } from './discovery'
import { ownedBy, reasonOf, type EthCall } from './ownership'
import { pgStore, type SmardexStore } from './store'
import { activeAddresses } from './wallets'

export const SMARDEX_SOURCE_ID = 'smardex'

export interface SmardexDeps {
  history: PositionHistory
  store: SmardexStore
  ethCall: EthCall
  prices: Pick<PriceProvider, 'getTokenPrices'>
  /** Addresses to look at: the active wallets of the Smardex list. */
  addresses: () => Promise<string[]>
  now?: () => number
}

/** Stable key of one position. The address is lowercase and the id never changes, so carry-forward always matches. */
export const positionRef = (address: string, p: PositionId) => `${address}:${positionKey(p)}`

export function createSmardexSource(deps: SmardexDeps): SourceType {
  const now = deps.now ?? Date.now

  return {
    id: SMARDEX_SOURCE_ID,

    async collect(): Promise<CollectResult> {
      const addresses = await deps.addresses()
      if (addresses.length === 0) return { lines: [], failures: [] }

      const lines: HoldingLine[] = []
      const failures: HoldingFailure[] = []

      // Every position is valued in wstETH, so one price covers all of them. Without it nothing can be valued.
      let wstEthUsd: Decimal | undefined
      let priceError = ''
      try {
        wstEthUsd = (await deps.prices.getTokenPrices('eth', [WSTETH])).get(WSTETH)
        if (!wstEthUsd) priceError = 'price lookup failed: wstETH has no price'
      } catch (err) {
        priceError = `price lookup failed: ${reasonOf(err)}`
      }

      for (const address of addresses) {
        // 1. Find positions. A failed scan must not hide what an earlier scan found, so the cache is used either way.
        const state = await deps.store.load(address)
        const candidates = new Map(state.positions.map((p) => [positionKey(p), p]))
        let scanError = ''
        try {
          const found = await deps.history.findNew(address, state.lastTxHash)
          if (found.newest) {
            // The marker only moves after the ids are stored (see the store), so a crash re-reads instead of skipping.
            await deps.store.save(address, found.positions, found.newest)
            for (const p of found.positions) candidates.set(positionKey(p), p)
          }
        } catch (err) {
          scanError = `could not read the transaction history: ${reasonOf(err)}`
        }

        // 2. Value the open ones.
        const open: PositionId[] = []
        for (const p of candidates.values()) {
          const ref = positionRef(address, p)
          try {
            const owned = await ownedBy(deps.ethCall, address, p)
            if (typeof owned === 'string') failures.push({ sourceRef: ref, reason: owned })
            else if (owned) open.push(p)
          } catch (err) {
            failures.push({ sourceRef: ref, reason: reasonOf(err) })
          }
        }

        if (!wstEthUsd) {
          for (const p of open) failures.push({ sourceRef: positionRef(address, p), reason: priceError })
        } else if (open.length > 0) {
          const timestamp = BigInt(Math.floor(now() / 1000))
          // The contract prices in 18 decimals, like wstETH itself.
          const price = BigInt(wstEthUsd.mul(new Decimal(10).pow(18)).toFixed(0))
          let outcomes: CallOutcome[]
          try {
            outcomes = await deps.ethCall(open.map((p) => ({ to: PROTOCOL, data: encodeGetPositionValue(p, price, timestamp) })))
          } catch (err) {
            outcomes = open.map(() => ({ ok: false as const, error: reasonOf(err) }))
          }
          open.forEach((p, i) => {
            const ref = positionRef(address, p)
            const outcome = outcomes[i]
            if (!outcome?.ok) {
              failures.push({ sourceRef: ref, reason: outcome?.error ?? 'no result returned' })
              return
            }
            try {
              const value = decodeInt256(outcome.result)
              // Under water counts as nothing, not as debt: the position cannot lose more than its collateral.
              const amount = fromBaseUnits(value > 0n ? value : 0n, WSTETH_DECIMALS)
              lines.push({ sourceRef: ref, symbol: 'wstETH', amount, priceUsd: wstEthUsd! })
            } catch (err) {
              failures.push({ sourceRef: ref, reason: reasonOf(err) })
            }
          })
        }

        // 3. A scan that failed may have missed a position that was never cached. The cached ones are still valued above,
        //    and this entry makes the snapshot partial instead of silently complete.
        if (scanError) failures.push({ sourceRef: `${address}:scan`, reason: scanError })
      }

      lines.sort((a, b) => a.sourceRef.localeCompare(b.sourceRef))
      failures.sort((a, b) => a.sourceRef.localeCompare(b.sourceRef))
      return { lines, failures }
    },
  }
}

/** The Smardex source wired to the real providers. */
export function createDefaultSmardexSource(): SourceType {
  return createSmardexSource({
    history: createBlockscoutHistory(),
    store: pgStore,
    ethCall: createEthCall('eth'),
    prices: createPriceProvider(createCoinGecko()),
    addresses: activeAddresses,
  })
}
