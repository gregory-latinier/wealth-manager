import { query } from '../../db/index'
import type { Decimal } from '../../lib/money'
import type { CollectResult, HoldingFailure, HoldingLine, SourceType } from '../types'
import { createBtcProvider } from './providers/btc'
import { createCoinGecko } from './providers/coingecko'
import { createEvmRpc } from './providers/evm-rpc'
import type { BtcProvider, EvmProvider, PriceProvider } from './providers/types'
import { isEvmChain, type Chain } from './validate'

export const CRYPTO_SOURCE_ID = 'crypto'

export interface CryptoProviders {
  btc: BtcProvider
  evm: EvmProvider
  prices: PriceProvider
}

interface NativeRow {
  chain: Chain
  address: string
  symbol: string
}

/** Stable key of an address's native coin inside the crypto source. Carry-forward matches on it. */
export const nativeRef = (chain: Chain, address: string) => `${chain}:${address}:native`

const reasonOf = (err: unknown) => (err instanceof Error ? err.message : String(err)).slice(0, 300)

/** Active addresses with an active native asset. Paused addresses and paused assets are skipped. */
async function loadNativeAssets(): Promise<NativeRow[]> {
  const res = await query<NativeRow>(
    `SELECT a."chain", a."address", s."symbol"
       FROM "CryptoAddress" a
       JOIN "CryptoAsset" s ON s."addressId" = a."id" AND s."kind" = 'native'
      WHERE a."active" AND s."active"
      ORDER BY a."createdAt", a."id"`
  )
  return res.rows
}

export function createCryptoSource(providers: CryptoProviders): SourceType {
  return {
    id: CRYPTO_SOURCE_ID,

    async collect(): Promise<CollectResult> {
      const rows = await loadNativeAssets()
      if (rows.length === 0) return { lines: [], failures: [] }

      const lines: HoldingLine[] = []
      const failures: HoldingFailure[] = []

      // One price call for every address. If it fails nothing can be valued, so every entry is a failure
      // (the engine carries each one forward) rather than a line priced at 0.
      let prices: { btc: Decimal; eth: Decimal }
      try {
        prices = await providers.prices.getNativePrices()
      } catch (err) {
        const reason = `price lookup failed: ${reasonOf(err)}`
        return { lines, failures: rows.map((r) => ({ sourceRef: nativeRef(r.chain, r.address), reason })) }
      }

      await Promise.all(
        rows.map(async (row) => {
          const sourceRef = nativeRef(row.chain, row.address)
          try {
            const amount = isEvmChain(row.chain)
              ? (await providers.evm.getBalances(row.chain, row.address, [])).native
              : await providers.btc.getBalance(row.address)
            lines.push({ sourceRef, symbol: row.symbol, amount, priceUsd: row.chain === 'btc' ? prices.btc : prices.eth })
          } catch (err) {
            failures.push({ sourceRef, reason: reasonOf(err) })
          }
        })
      )

      // Promise.all finishes in provider order; sort so the result does not depend on network timing.
      lines.sort((a, b) => a.sourceRef.localeCompare(b.sourceRef))
      failures.sort((a, b) => a.sourceRef.localeCompare(b.sourceRef))
      return { lines, failures }
    },
  }
}

/** The crypto source wired to the real providers. */
export function createDefaultCryptoSource(): SourceType {
  return createCryptoSource({ btc: createBtcProvider(), evm: createEvmRpc(), prices: createCoinGecko() })
}
