import { fromBaseUnits, type Decimal } from '../../../lib/money'
import { createLimiter, DEFAULT_TIMEOUT_MS, fetchJson, type FetchLike } from './http'
import { ProviderError, type SolProvider, type SolTokenProvider, type SplBalance } from './types'

const PROVIDER = 'solana-rpc'
const LAMPORT_DECIMALS = 9
const MAX_DECIMALS = 36
// Token accounts of the classic SPL program. Token-2022 accounts are a separate program and are not read.
const TOKEN_PROGRAM = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA'

export const DEFAULT_SOL_RPC_URLS = ['https://api.mainnet-beta.solana.com']

/** `SOL_RPC_URL` is a comma-separated list that replaces the default. */
export function solRpcUrlsFromEnv(env: NodeJS.ProcessEnv = process.env): string[] {
  const urls = (env.SOL_RPC_URL ?? '').split(',').map((u) => u.trim()).filter(Boolean)
  return urls.length > 0 ? urls : DEFAULT_SOL_RPC_URLS
}

/** The `result` of a JSON-RPC answer. An RPC error is a failure, never an empty or zero result. */
function resultOf(payload: unknown, method: string): unknown {
  const body = payload as { result?: unknown; error?: { message?: unknown } } | null
  if (body?.error) throw new ProviderError(PROVIDER, 'rpc', `${method}: ${String(body.error.message ?? 'error')}`.slice(0, 200))
  if (body === null || typeof body !== 'object' || body.result === undefined || body.result === null) {
    throw new ProviderError(PROVIDER, 'malformed', `${method}: no result`)
  }
  return body.result
}

/** Parses a `getBalance` answer into SOL. Exported for tests. */
export function parseSolBalance(payload: unknown): Decimal {
  const lamports = (resultOf(payload, 'getBalance') as { value?: unknown }).value
  // JSON numbers are exact up to 2^53 lamports (about 9 million SOL), far above any wallet tracked here.
  if (typeof lamports !== 'number' || !Number.isSafeInteger(lamports) || lamports < 0) {
    throw new ProviderError(PROVIDER, 'malformed', 'getBalance: value is not a valid lamport amount')
  }
  return fromBaseUnits(BigInt(lamports), LAMPORT_DECIMALS)
}

/**
 * Parses a `getTokenAccountsByOwner` answer (jsonParsed). A wallet can hold several accounts of the same mint, so they are summed.
 * The amount is read from the integer string, never from the float `uiAmount`. An account that does not look right is skipped:
 * one odd entry must not hide the others. Exported for tests.
 */
export function parseTokenAccounts(payload: unknown): SplBalance[] {
  const value = (resultOf(payload, 'getTokenAccountsByOwner') as { value?: unknown }).value
  if (!Array.isArray(value)) throw new ProviderError(PROVIDER, 'malformed', 'getTokenAccountsByOwner: value is not a list')

  const byMint = new Map<string, { decimals: number; raw: bigint }>()
  for (const entry of value) {
    const info = (entry as { account?: { data?: { parsed?: { info?: unknown } } } } | null)?.account?.data?.parsed?.info as
      | { mint?: unknown; tokenAmount?: { amount?: unknown; decimals?: unknown } }
      | undefined
    const mint = info?.mint
    const amount = info?.tokenAmount?.amount
    const decimals = info?.tokenAmount?.decimals
    if (typeof mint !== 'string' || typeof amount !== 'string' || !/^\d+$/.test(amount)) continue
    if (typeof decimals !== 'number' || !Number.isInteger(decimals) || decimals < 0 || decimals > MAX_DECIMALS) continue
    const known = byMint.get(mint)
    byMint.set(mint, { decimals, raw: (known?.raw ?? 0n) + BigInt(amount) })
  }
  return [...byMint].map(([mint, { decimals, raw }]) => ({ mint, decimals, balance: fromBaseUnits(raw, decimals) }))
}

/** Parses a `getTokenSupply` answer into the decimals of the mint. A wallet address is not a mint and answers with an error. Exported for tests. */
export function parseMintDecimals(payload: unknown): number {
  const decimals = ((resultOf(payload, 'getTokenSupply') as { value?: { decimals?: unknown } }).value ?? {}).decimals
  if (typeof decimals !== 'number' || !Number.isInteger(decimals) || decimals < 0 || decimals > MAX_DECIMALS) {
    throw new ProviderError(PROVIDER, 'malformed', 'getTokenSupply: decimals out of range')
  }
  return decimals
}

export function createSolanaRpc(
  options: { fetch?: FetchLike; urls?: string[]; timeoutMs?: number; concurrency?: number } = {}
): SolProvider & SolTokenProvider {
  const doFetch = options.fetch ?? fetch
  const urls = options.urls ?? solRpcUrlsFromEnv()
  const limit = createLimiter(options.concurrency ?? 2)

  /** Sends one call to the first URL that answers and parses it. The public endpoint rate limits, so a failure moves on to the next URL. */
  async function call<T>(method: string, params: unknown[], parse: (payload: unknown) => T): Promise<T> {
    const request = { jsonrpc: '2.0', id: 1, method, params }
    let lastError: ProviderError | undefined
    for (const url of urls) {
      try {
        const body = await limit(() => fetchJson(PROVIDER, doFetch, url, { method: 'POST', body: request, timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS }))
        return parse(body)
      } catch (err) {
        if (!(err instanceof ProviderError)) throw err
        lastError = err
      }
    }
    throw lastError ?? new ProviderError(PROVIDER, 'network', 'no RPC URL configured for Solana')
  }

  return {
    getBalance: (address) => call('getBalance', [address, { commitment: 'finalized' }], parseSolBalance),
    getTokenBalances: (address) =>
      call('getTokenAccountsByOwner', [address, { programId: TOKEN_PROGRAM }, { encoding: 'jsonParsed', commitment: 'finalized' }], parseTokenAccounts),
    getMintDecimals: (mint) => call('getTokenSupply', [mint, { commitment: 'finalized' }], parseMintDecimals),
  }
}
