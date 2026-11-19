import { fromBaseUnits, type Decimal } from '../../../lib/money'
import { createLimiter, DEFAULT_TIMEOUT_MS, fetchJson, type FetchLike } from './http'
import { ProviderError, type BtcProvider } from './types'

const PROVIDER = 'mempool.space'
const SATS_DECIMALS = 8

function sats(stats: unknown, field: string): bigint {
  const value = (stats as Record<string, unknown> | null)?.[field]
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw new ProviderError(PROVIDER, 'malformed', `chain_stats.${field} is not a valid satoshi amount`)
  }
  return BigInt(value)
}

/** Parses a mempool.space `/api/address/{addr}` payload into a confirmed BTC balance. Exported for tests. */
export function parseMempoolAddress(payload: unknown): Decimal {
  const chain = (payload as { chain_stats?: unknown } | null)?.chain_stats
  if (!chain || typeof chain !== 'object') throw new ProviderError(PROVIDER, 'malformed', 'chain_stats is missing')

  // Confirmed only: mempool_stats is ignored so an unconfirmed transaction never moves the daily value.
  const balance = sats(chain, 'funded_txo_sum') - sats(chain, 'spent_txo_sum')
  if (balance < 0n) throw new ProviderError(PROVIDER, 'malformed', 'spent exceeds funded')
  return fromBaseUnits(balance, SATS_DECIMALS)
}

export function createBtcProvider(
  options: { fetch?: FetchLike; baseUrl?: string; timeoutMs?: number; concurrency?: number } = {}
): BtcProvider {
  const doFetch = options.fetch ?? fetch
  const baseUrl = (options.baseUrl ?? 'https://mempool.space').replace(/\/+$/, '')
  const limit = createLimiter(options.concurrency ?? 2)

  return {
    getBalance: (address) =>
      limit(async () =>
        parseMempoolAddress(
          await fetchJson(PROVIDER, doFetch, `${baseUrl}/api/address/${encodeURIComponent(address)}`, {
            timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
          })
        )
      ),
  }
}
