import { dec, type Decimal } from '../../../lib/money'
import { createLimiter, DEFAULT_TIMEOUT_MS, fetchJson, type FetchLike } from './http'
import { ProviderError, type EvmChain, type PriceProvider } from './types'

const PROVIDER = 'coingecko'
const PLATFORM: Record<EvmChain, string> = { eth: 'ethereum', base: 'base' }
// The documented maximum is 515 contracts per request. Stay well below it to keep the URL short.
const CONTRACTS_PER_REQUEST = 100

/** Reads `{ [key]: { usd: number } }`. A missing key or a null/zero price is `undefined`, never 0. */
function usdPrice(payload: Record<string, unknown>, key: string): Decimal | undefined {
  const entry = payload[key]
  if (entry === undefined || entry === null) return undefined
  const usd = (entry as { usd?: unknown }).usd
  if (usd === undefined || usd === null) return undefined
  if (typeof usd !== 'number' || !Number.isFinite(usd) || usd < 0) {
    throw new ProviderError(PROVIDER, 'malformed', `price for ${key} is not a valid number`)
  }
  return usd === 0 ? undefined : dec(String(usd))
}

function asObject(payload: unknown): Record<string, unknown> {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new ProviderError(PROVIDER, 'malformed', 'expected a JSON object')
  }
  return payload as Record<string, unknown>
}

/** Parses `simple/price?ids=bitcoin,ethereum`. Both coins are required. Exported for tests. */
export function parseNativePrices(payload: unknown): { btc: Decimal; eth: Decimal } {
  const body = asObject(payload)
  const btc = usdPrice(body, 'bitcoin')
  const eth = usdPrice(body, 'ethereum')
  if (!btc || !eth) throw new ProviderError(PROVIDER, 'malformed', 'bitcoin or ethereum price is missing')
  return { btc, eth }
}

/** Parses `simple/token_price/{platform}`. Unknown contracts are simply absent from the map. Exported for tests. */
export function parseTokenPrices(payload: unknown, contracts: string[]): Map<string, Decimal> {
  const body = asObject(payload)
  // CoinGecko answers in lowercase; look contracts up by their lowercase form.
  const lower = new Map(Object.entries(body).map(([k, v]) => [k.toLowerCase(), v]))
  const prices = new Map<string, Decimal>()
  for (const contract of contracts) {
    const price = usdPrice(Object.fromEntries(lower), contract)
    if (price) prices.set(contract, price)
  }
  return prices
}

export function createCoinGecko(
  options: { fetch?: FetchLike; baseUrl?: string; apiKey?: string; timeoutMs?: number; concurrency?: number } = {}
): PriceProvider {
  const doFetch = options.fetch ?? fetch
  const baseUrl = (options.baseUrl ?? 'https://api.coingecko.com/api/v3').replace(/\/+$/, '')
  const apiKey = options.apiKey ?? process.env.COINGECKO_API_KEY
  const limit = createLimiter(options.concurrency ?? 2)

  const get = (path: string) =>
    limit(() =>
      fetchJson(PROVIDER, doFetch, `${baseUrl}${path}`, {
        headers: apiKey ? { 'x-cg-demo-api-key': apiKey } : undefined,
        timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      })
    )

  return {
    async getNativePrices() {
      return parseNativePrices(await get('/simple/price?ids=bitcoin,ethereum&vs_currencies=usd'))
    },

    async getTokenPrices(chain, contracts) {
      const unique = [...new Set(contracts.map((c) => c.toLowerCase()))]
      const prices = new Map<string, Decimal>()
      const chunks: string[][] = []
      for (let i = 0; i < unique.length; i += CONTRACTS_PER_REQUEST) chunks.push(unique.slice(i, i + CONTRACTS_PER_REQUEST))

      const bodies = await Promise.all(
        chunks.map((chunk) =>
          get(`/simple/token_price/${PLATFORM[chain]}?contract_addresses=${chunk.join(',')}&vs_currencies=usd`)
        )
      )
      bodies.forEach((body, i) => {
        for (const [contract, price] of parseTokenPrices(body, chunks[i])) prices.set(contract, price)
      })
      return prices
    },
  }
}
