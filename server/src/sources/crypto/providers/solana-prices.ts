import { dec } from '../../../lib/money'
import { createLimiter, DEFAULT_TIMEOUT_MS, fetchJson, type FetchLike } from './http'
import { ProviderError, type SolTokenPriceProvider, type SplPrice } from './types'

const PROVIDER = 'defillama'
const MINTS_PER_REQUEST = 50
// A price older than this is not trusted as current.
const MAX_AGE = '4h'
const MAX_SYMBOL_LENGTH = 32

const cleanSymbol = (value: unknown): string =>
  typeof value === 'string' ? value.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, MAX_SYMBOL_LENGTH) : ''

/**
 * Parses `prices/current/{solana:mint,...}`. The answer is matched on the exact key `solana:<mint>`, so the case of a mint is never
 * folded. DefiLlama also answers a lowercased mint with the price of the real one, which is why nothing here compares in lowercase.
 * A missing, zero or non-numeric price leaves the mint unpriced. Exported for tests.
 */
export function parseSplPrices(payload: unknown, mints: string[]): Map<string, SplPrice> {
  const coins = (payload as { coins?: unknown } | null)?.coins
  if (!coins || typeof coins !== 'object' || Array.isArray(coins)) {
    throw new ProviderError(PROVIDER, 'malformed', 'expected a "coins" object')
  }
  const byKey = coins as Record<string, { price?: unknown; symbol?: unknown } | undefined>
  const prices = new Map<string, SplPrice>()
  for (const mint of mints) {
    const entry = Object.prototype.hasOwnProperty.call(byKey, `solana:${mint}`) ? byKey[`solana:${mint}`] : undefined
    const price = entry?.price
    if (price === undefined || price === null) continue
    if (typeof price !== 'number' || !Number.isFinite(price) || price < 0) {
      throw new ProviderError(PROVIDER, 'malformed', `price for ${mint} is not a valid number`)
    }
    if (price > 0) prices.set(mint, { priceUsd: dec(String(price)), symbol: cleanSymbol(entry?.symbol) })
  }
  return prices
}

export function createSolanaTokenPrices(
  options: { fetch?: FetchLike; baseUrl?: string; timeoutMs?: number; concurrency?: number } = {}
): SolTokenPriceProvider {
  const doFetch = options.fetch ?? fetch
  const baseUrl = (options.baseUrl ?? 'https://coins.llama.fi').replace(/\/+$/, '')
  const limit = createLimiter(options.concurrency ?? 2)

  return {
    async getSplPrices(mints) {
      const unique = [...new Set(mints)]
      const chunks: string[][] = []
      for (let i = 0; i < unique.length; i += MINTS_PER_REQUEST) chunks.push(unique.slice(i, i + MINTS_PER_REQUEST))

      const bodies = await Promise.all(
        chunks.map((chunk) =>
          limit(() =>
            fetchJson(PROVIDER, doFetch, `${baseUrl}/prices/current/${chunk.map((m) => `solana:${m}`).join(',')}?searchWidth=${MAX_AGE}`, {
              timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
            })
          )
        )
      )
      const prices = new Map<string, SplPrice>()
      bodies.forEach((body, i) => {
        for (const [mint, price] of parseSplPrices(body, chunks[i])) prices.set(mint, price)
      })
      return prices
    },
  }
}
