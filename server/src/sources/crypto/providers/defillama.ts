import { dec, type Decimal } from '../../../lib/money'
import { createLimiter, DEFAULT_TIMEOUT_MS, fetchJson, type FetchLike } from './http'
import { ProviderError, type EvmChain, type PriceProvider } from './types'

const PROVIDER = 'defillama'
const CHAIN: Record<EvmChain, string> = { eth: 'ethereum', base: 'base', bsc: 'bsc' }
// Contracts go in the URL path, so keep each request short.
const CONTRACTS_PER_REQUEST = 50
// A price older than this is not trusted as current.
const MAX_AGE = '4h'

/** Parses `prices/current/{chain:contract,...}`. Unknown contracts are absent. A zero or missing price is `undefined`, never 0. Exported for tests. */
export function parseLlamaPrices(payload: unknown, chain: EvmChain, contracts: string[]): Map<string, Decimal> {
  const coins = (payload as { coins?: unknown } | null)?.coins
  if (!coins || typeof coins !== 'object' || Array.isArray(coins)) {
    throw new ProviderError(PROVIDER, 'malformed', 'expected a "coins" object')
  }
  const byKey = new Map(Object.entries(coins).map(([k, v]) => [k.toLowerCase(), v]))
  const prices = new Map<string, Decimal>()
  for (const contract of contracts) {
    const entry = byKey.get(`${CHAIN[chain]}:${contract}`) as { price?: unknown } | undefined
    const price = entry?.price
    if (price === undefined || price === null) continue
    if (typeof price !== 'number' || !Number.isFinite(price) || price < 0) {
      throw new ProviderError(PROVIDER, 'malformed', `price for ${contract} is not a valid number`)
    }
    if (price > 0) prices.set(contract, dec(String(price)))
  }
  return prices
}

/** Keyless token prices that accept many contracts per request, which CoinGecko's free tier no longer does. */
export function createDefiLlamaTokenPrices(
  options: { fetch?: FetchLike; baseUrl?: string; timeoutMs?: number; concurrency?: number } = {}
): Pick<PriceProvider, 'getTokenPrices'> {
  const doFetch = options.fetch ?? fetch
  const baseUrl = (options.baseUrl ?? 'https://coins.llama.fi').replace(/\/+$/, '')
  const limit = createLimiter(options.concurrency ?? 2)

  return {
    async getTokenPrices(chain, contracts) {
      const unique = [...new Set(contracts.map((c) => c.toLowerCase()))]
      const prices = new Map<string, Decimal>()
      const chunks: string[][] = []
      for (let i = 0; i < unique.length; i += CONTRACTS_PER_REQUEST) chunks.push(unique.slice(i, i + CONTRACTS_PER_REQUEST))

      const bodies = await Promise.all(
        chunks.map((chunk) =>
          limit(() =>
            fetchJson(PROVIDER, doFetch, `${baseUrl}/prices/current/${chunk.map((c) => `${CHAIN[chain]}:${c}`).join(',')}?searchWidth=${MAX_AGE}`, {
              timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
            })
          )
        )
      )
      bodies.forEach((body, i) => {
        for (const [contract, price] of parseLlamaPrices(body, chain, chunks[i])) prices.set(contract, price)
      })
      return prices
    },
  }
}

/**
 * Native prices from `native`, token prices from DefiLlama first. If DefiLlama fails (not if it merely does not know a token),
 * the token prices fall back to `native`'s own lookup.
 */
export function createPriceProvider(native: PriceProvider, tokens: Pick<PriceProvider, 'getTokenPrices'> = createDefiLlamaTokenPrices()): PriceProvider {
  return {
    getNativePrices: () => native.getNativePrices(),
    async getTokenPrices(chain, contracts) {
      try {
        return await tokens.getTokenPrices(chain, contracts)
      } catch (err) {
        if (!(err instanceof ProviderError)) throw err
        return native.getTokenPrices(chain, contracts)
      }
    },
  }
}
