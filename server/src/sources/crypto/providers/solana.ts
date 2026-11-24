import { fromBaseUnits, type Decimal } from '../../../lib/money'
import { createLimiter, DEFAULT_TIMEOUT_MS, fetchJson, type FetchLike } from './http'
import { ProviderError, type SolProvider } from './types'

const PROVIDER = 'solana-rpc'
const LAMPORT_DECIMALS = 9

export const DEFAULT_SOL_RPC_URLS = ['https://api.mainnet-beta.solana.com']

/** `SOL_RPC_URL` is a comma-separated list that replaces the default. */
export function solRpcUrlsFromEnv(env: NodeJS.ProcessEnv = process.env): string[] {
  const urls = (env.SOL_RPC_URL ?? '').split(',').map((u) => u.trim()).filter(Boolean)
  return urls.length > 0 ? urls : DEFAULT_SOL_RPC_URLS
}

/** Parses a `getBalance` answer into SOL. An RPC error is a failure, never a zero balance. Exported for tests. */
export function parseSolBalance(payload: unknown): Decimal {
  const body = payload as { result?: { value?: unknown }; error?: { message?: unknown } } | null
  if (body?.error) throw new ProviderError(PROVIDER, 'rpc', `getBalance: ${String(body.error.message ?? 'error')}`.slice(0, 200))
  const lamports = body?.result?.value
  // JSON numbers are exact up to 2^53 lamports (about 9 million SOL), far above any wallet tracked here.
  if (typeof lamports !== 'number' || !Number.isSafeInteger(lamports) || lamports < 0) {
    throw new ProviderError(PROVIDER, 'malformed', 'getBalance: value is not a valid lamport amount')
  }
  return fromBaseUnits(BigInt(lamports), LAMPORT_DECIMALS)
}

export function createSolanaRpc(options: { fetch?: FetchLike; urls?: string[]; timeoutMs?: number; concurrency?: number } = {}): SolProvider {
  const doFetch = options.fetch ?? fetch
  const urls = options.urls ?? solRpcUrlsFromEnv()
  const limit = createLimiter(options.concurrency ?? 2)

  return {
    async getBalance(address) {
      const request = { jsonrpc: '2.0', id: 1, method: 'getBalance', params: [address, { commitment: 'finalized' }] }
      let lastError: ProviderError | undefined
      // The public endpoint rate limits, so a failure moves on to the next URL when there is one.
      for (const url of urls) {
        try {
          const body = await limit(() => fetchJson(PROVIDER, doFetch, url, { method: 'POST', body: request, timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS }))
          return parseSolBalance(body)
        } catch (err) {
          if (!(err instanceof ProviderError)) throw err
          lastError = err
        }
      }
      throw lastError ?? new ProviderError(PROVIDER, 'network', 'no RPC URL configured for Solana')
    },
  }
}
