import { query } from '../../db/index'
import { dec, type Decimal } from '../../lib/money'
import type { CollectResult, HoldingFailure, HoldingLine, SourceType } from '../types'
import { createBtcProvider } from './providers/btc'
import { createCoinGecko } from './providers/coingecko'
import { createPriceProvider } from './providers/defillama'
import { createEvmRpc } from './providers/evm-rpc'
import { createSolanaRpc } from './providers/solana'
import { createSolanaTokenPrices } from './providers/solana-prices'
import type { BtcProvider, EvmChain, EvmProvider, NativePrices, PriceProvider, SolProvider, SolTokenPriceProvider, SolTokenProvider } from './providers/types'
import { EVM_CHAINS, isEvmChain, type Chain } from './validate'

export const CRYPTO_SOURCE_ID = 'crypto'

export interface CryptoProviders {
  btc: BtcProvider
  evm: EvmProvider
  prices: PriceProvider
  /** Optional so a caller that never tracks Solana does not have to provide one. A Solana address then fails, it is not valued at 0. */
  sol?: SolProvider & Partial<SolTokenProvider>
  /** Prices of SPL tokens by mint. Without it a tracked Solana token fails, it is not valued at 0. */
  splPrices?: SolTokenPriceProvider
}

/** Which native coin pays for gas on an EVM chain, and so which price values the balance. Base and Arbitrum use ETH. */
const GAS_PRICE_KEY: Record<EvmChain, 'eth' | 'bnb'> = { eth: 'eth', base: 'eth', arb: 'eth', bsc: 'bnb' }
const PRICE_NAME: Record<'eth' | 'bnb' | 'sol', string> = { eth: 'ETH', bnb: 'BNB', sol: 'SOL' }

function nativePrice(native: NativePrices, key: 'eth' | 'bnb' | 'sol') {
  const price = native[key]
  if (!price) throw new Error(`price lookup failed: ${PRICE_NAME[key]} price is missing`)
  return price
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
      let native: NativePrices
      try {
        native = await providers.prices.getNativePrices()
      } catch (err) {
        failAll(`price lookup failed: ${reasonOf(err)}`)
        return { lines, failures }
      }

      // Token prices, one call per chain. A failed lookup fails that chain's tokens only. A contract the
      // provider does not know is a failure for that token (the owner was warned when adding it, see SC5).
      const tokenPrices = new Map<EvmChain, Map<string, Decimal> | string>()
      for (const chain of EVM_CHAINS) {
        const contracts = holders.filter((h) => h.chain === chain).flatMap((h) => h.tokens.map((t) => t.contractAddress!))
        if (contracts.length === 0) continue
        try {
          tokenPrices.set(chain, await providers.prices.getTokenPrices(chain, contracts))
        } catch (err) {
          tokenPrices.set(chain, `price lookup failed: ${reasonOf(err)}`)
        }
      }

      /** SOL balance plus every tracked SPL token of one wallet. A token fails alone: a missing price or read never hides the SOL. */
      const collectSolana = async (holder: Holder) => {
        if (!providers.sol) throw new Error('Solana is not configured')
        // The balance is read before the price is checked, so a missing SOL price is reported as such and not as an RPC failure.
        const amount = await providers.sol.getBalance(holder.address)
        if (holder.native) {
          lines.push({ sourceRef: nativeRef('sol', holder.address), symbol: holder.native.symbol, amount, priceUsd: nativePrice(native, 'sol') })
        }
        if (holder.tokens.length === 0) return

        const failTokens = (reason: string) => {
          for (const t of holder.tokens) failures.push({ sourceRef: tokenRef('sol', holder.address, t.contractAddress!), reason })
        }
        if (!providers.sol.getTokenBalances || !providers.splPrices) return failTokens('Solana tokens are not configured')

        let held: Map<string, Decimal>
        try {
          held = new Map((await providers.sol.getTokenBalances(holder.address)).map((b) => [b.mint, b.balance]))
        } catch (err) {
          return failTokens(reasonOf(err))
        }
        let prices: Awaited<ReturnType<SolTokenPriceProvider['getSplPrices']>>
        try {
          prices = await providers.splPrices.getSplPrices(holder.tokens.map((t) => t.contractAddress!))
        } catch (err) {
          return failTokens(`price lookup failed: ${reasonOf(err)}`)
        }
        for (const token of holder.tokens) {
          const ref = tokenRef('sol', holder.address, token.contractAddress!)
          const price = prices.get(token.contractAddress!)
          // A wallet that no longer has a token account for the mint holds none of it: that is a real zero, not a failed read.
          const balance = held.get(token.contractAddress!) ?? dec(0)
          // A price DefiLlama does not have is a failure so the last value is carried forward. Valuing it at 0 would drop it from the net worth.
          // An empty balance has nothing to lose, so it is valued at 0 and does not keep the snapshot partial.
          if (price) lines.push({ sourceRef: ref, symbol: token.symbol, amount: balance, priceUsd: price.priceUsd })
          else if (balance.isZero()) lines.push({ sourceRef: ref, symbol: token.symbol, amount: balance, priceUsd: dec(0) })
          else failures.push({ sourceRef: ref, reason: `no USD price for ${token.symbol}` })
        }
      }

      await Promise.all(
        holders.map(async (holder) => {
          try {
            if (holder.chain === 'btc') {
              const amount = await providers.btc.getBalance(holder.address)
              if (holder.native) {
                lines.push({ sourceRef: nativeRef('btc', holder.address), symbol: holder.native.symbol, amount, priceUsd: native.btc })
              }
              return
            }
            if (holder.chain === 'sol') {
              await collectSolana(holder)
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
              // ETH on Ethereum, Base and Arbitrum, BNB on BNB Chain. A missing BNB price fails this address only.
              const priceUsd = nativePrice(native, GAS_PRICE_KEY[chain])
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
                const priceUsd = prices.get(token.contractAddress!)
                if (priceUsd) lines.push({ sourceRef: ref, symbol: token.symbol, amount: balance.balance, priceUsd })
                // Same rule as for Solana tokens: no price is a failure, so the last value is carried forward and the token cannot
                // drop out of the net worth. An empty balance has nothing to lose, so it is valued at 0 and does not keep the snapshot partial.
                else if (balance.balance.isZero()) lines.push({ sourceRef: ref, symbol: token.symbol, amount: balance.balance, priceUsd: dec(0) })
                else failures.push({ sourceRef: ref, reason: `no USD price for ${token.symbol}` })
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
  return createCryptoSource({ btc: createBtcProvider(), evm: createEvmRpc(), sol: createSolanaRpc(), splPrices: createSolanaTokenPrices(), prices: createPriceProvider(createCoinGecko()) })
}
