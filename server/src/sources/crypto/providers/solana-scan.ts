import type { Decimal } from '../../../lib/money'
import type { ScanProvider, ScanToken } from './blockscout'
import type { SolTokenPriceProvider, SolTokenProvider } from './types'

const MAX_SYMBOL_LENGTH = 32

/** First characters of a mint, used as the name of a token that has no symbol. A mint is already printable base58. */
const shortMint = (mint: string) => `${mint.slice(0, 4)}…${mint.slice(-4)}`

/**
 * Scan source for Solana: every SPL token the wallet holds, priced by DefiLlama.
 * A wallet often holds dozens of worthless airdropped tokens. Only the ones with a price at or above the threshold are
 * preselected by the scan, the rest stay unpriced and are never tracked without a click.
 * A price failure leaves the tokens unpriced instead of failing the scan, and says so, so it is not read as "worthless".
 */
export function createSolanaScan(providers: { tokens: SolTokenProvider; prices: SolTokenPriceProvider }): ScanProvider {
  const priceFailed = new Set<string>()
  // Addresses are case-sensitive here too: a wallet is never lowercased.
  const key = (address: string) => address

  return {
    pricesUnavailable: (_chain, address) => priceFailed.has(key(address)),
    support: (chain) => (chain === 'sol' ? { enabled: true } : { enabled: false, reason: 'Not a Solana address.' }),

    async listTokens(_chain, address) {
      priceFailed.delete(key(address))
      const held = (await providers.tokens.getTokenBalances(address)).filter((t) => !t.balance.isZero())
      if (held.length === 0) return []

      let prices = new Map<string, { priceUsd: Decimal; symbol: string }>()
      try {
        prices = await providers.prices.getSplPrices(held.map((t) => t.mint))
      } catch {
        priceFailed.add(key(address))
      }

      return held.map((t): ScanToken => {
        const price = prices.get(t.mint)
        const symbol = (price?.symbol || shortMint(t.mint)).slice(0, MAX_SYMBOL_LENGTH)
        return {
          contract: t.mint,
          symbol,
          name: price?.symbol ? '' : 'Unknown token',
          decimals: t.decimals,
          balance: t.balance,
          priceUsd: price?.priceUsd ?? null,
          // No reputation signal exists for Solana: an unpriced token is simply listed apart, not flagged as spam.
          reputation: null,
        }
      })
    },
  }
}

