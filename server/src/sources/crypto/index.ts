import { query } from '../../db/index'
import { dec, type Decimal } from '../../lib/money'
import type { CollectResult, HoldingFailure, HoldingLine, SourceType } from '../types'
import { createBtcProvider } from './providers/btc'
import { createCoinGecko } from './providers/coingecko'
import { createPriceProvider } from './providers/defillama'
import { createEvmRpc } from './providers/evm-rpc'
import type { BtcProvider, EvmChain, EvmProvider, PriceProvider } from './providers/types'
import { isEvmChain, type Chain } from './validate'

export const CRYPTO_SOURCE_ID = 'crypto'

export interface CryptoProviders {
  btc: BtcProvider
  evm: EvmProvider
  prices: PriceProvider
}

interface AssetRow {
  chain: Chain
  address: string
  kind: 'native' | 'token'
  symbol: string
  contractAddress: string | null
  decimals: number
}

interface Holder {
  chain: Chain
  address: string
  native?: AssetRow
  tokens: AssetRow[]
}

/** Stable key of an address's native coin inside the crypto source. Carry-forward matches on it. */
export const nativeRef = (chain: Chain, address: string) => `${chain}:${address}:native`
/** Stable key of a tracked token. The contract is lowercase, so the key never changes with casing. */
export const tokenRef = (chain: Chain, address: string, contract: string) => `${chain}:${address}:${contract}`

const reasonOf = (err: unknown) => (err instanceof Error ? err.message : String(err)).slice(0, 300)

/** Active assets of active addresses. Paused addresses and paused assets are skipped. */
async function loadHolders(): Promise<Holder[]> {
  const res = await query<AssetRow>(
    `SELECT a."chain", a."address", s."kind", s."symbol", s."contractAddress", s."decimals"
       FROM "CryptoAddress" a
       JOIN "CryptoAsset" s ON s."addressId" = a."id"
      WHERE a."active" AND s."active"
      ORDER BY a."createdAt", a."id", s."createdAt", s."id"`
  )
  const holders = new Map<string, Holder>()
  for (const row of res.rows) {
    const key = `${row.chain}:${row.address}`
    const holder = holders.get(key) ?? { chain: row.chain, address: row.address, tokens: [] }
    if (row.kind === 'native') holder.native = row
    else holder.tokens.push(row)
    holders.set(key, holder)
  }
  return [...holders.values()]
}

export function createCryptoSource(providers: CryptoProviders): SourceType {
  return {
    id: CRYPTO_SOURCE_ID,

    async collect(): Promise<CollectResult> {
      const holders = await loadHolders()
      if (holders.length === 0) return { lines: [], failures: [] }

      const lines: HoldingLine[] = []
      const failures: HoldingFailure[] = []
      const failAll = (reason: string, subset: Holder[] = holders) => {
        for (const h of subset) {
          if (h.native) failures.push({ sourceRef: nativeRef(h.chain, h.address), reason })
          for (const t of h.tokens) failures.push({ sourceRef: tokenRef(h.chain, h.address, t.contractAddress!), reason })
        }
      }

      // Native prices cover every address. If that call fails nothing can be valued, so every entry is
      // a failure (the engine carries each one forward) rather than a line priced at 0.
      let native: { btc: Decimal; eth: Decimal; bnb?: Decimal }
      try {
        native = await providers.prices.getNativePrices()
      } catch (err) {
        failAll(`price lookup failed: ${reasonOf(err)}`)
        return { lines, failures }
      }

      // Token prices, one call per chain. A failed lookup fails that chain's tokens only. A contract the
      // provider does not know is valued at 0 (the owner was warned when adding it, see SC5).
      const tokenPrices = new Map<EvmChain, Map<string, Decimal> | string>()
      for (const chain of ['eth', 'base', 'bsc'] as const) {
        const contracts = holders.filter((h) => h.chain === chain).flatMap((h) => h.tokens.map((t) => t.contractAddress!))
        if (contracts.length === 0) continue
        try {
          tokenPrices.set(chain, await providers.prices.getTokenPrices(chain, contracts))
        } catch (err) {
          tokenPrices.set(chain, `price lookup failed: ${reasonOf(err)}`)
        }
      }

      await Promise.all(
        holders.map(async (holder) => {
          try {
            if (!isEvmChain(holder.chain)) {
              const amount = await providers.btc.getBalance(holder.address)
              if (holder.native) {
                lines.push({ sourceRef: nativeRef('btc', holder.address), symbol: holder.native.symbol, amount, priceUsd: native.btc })
              }
              return
            }

            // One batch per address: native balance plus every tracked token.
            const chain = holder.chain
            const balances = await providers.evm.getBalances(
              chain,
              holder.address,
              holder.tokens.map((t) => ({ contract: t.contractAddress!, decimals: t.decimals }))
            )
            if (holder.native) {
              // ETH on Ethereum and Base, BNB on BNB Chain. A missing BNB price fails this address only.
              const priceUsd = chain === 'bsc' ? native.bnb : native.eth
              if (!priceUsd) throw new Error('price lookup failed: BNB price is missing')
              lines.push({ sourceRef: nativeRef(chain, holder.address), symbol: holder.native.symbol, amount: balances.native, priceUsd })
            }

            const prices = tokenPrices.get(chain)
            for (const token of holder.tokens) {
              const ref = tokenRef(chain, holder.address, token.contractAddress!)
              const balance = balances.tokens[token.contractAddress!]
              if (!balance || !balance.ok) {
                failures.push({ sourceRef: ref, reason: balance ? reasonOf(balance.error) : 'no balance returned' })
              } else if (typeof prices === 'string' || prices === undefined) {
                failures.push({ sourceRef: ref, reason: prices ?? 'price lookup failed' })
              } else {
                lines.push({ sourceRef: ref, symbol: token.symbol, amount: balance.balance, priceUsd: prices.get(token.contractAddress!) ?? dec(0) })
              }
            }
          } catch (err) {
            // The address as a whole failed (native balance, RPC down): report every entry it owns.
            failAll(reasonOf(err), [holder])
          }
        })
      )

      // Promise.all finishes in network order; sort so the result does not depend on timing.
      lines.sort((a, b) => a.sourceRef.localeCompare(b.sourceRef))
      failures.sort((a, b) => a.sourceRef.localeCompare(b.sourceRef))
      return { lines, failures }
    },
  }
}

/** The crypto source wired to the real providers. */
export function createDefaultCryptoSource(): SourceType {
  return createCryptoSource({ btc: createBtcProvider(), evm: createEvmRpc(), prices: createPriceProvider(createCoinGecko()) })
}
