import { fromBaseUnits, type Decimal } from '../../../lib/money'
import { createLimiter, DEFAULT_TIMEOUT_MS, fetchJson, type FetchLike } from './http'
import {
  ProviderError,
  type EvmBalances,
  type EvmChain,
  type EvmProvider,
  type TokenBalance,
  type TokenMetadata,
  type TokenRef,
} from './types'

const BALANCE_OF = '0x70a08231'
const DECIMALS = '0x313ce567'
const SYMBOL = '0x95d89b41'
const MAX_SYMBOL_LENGTH = 32

export const DEFAULT_RPC_URLS: Record<EvmChain, string[]> = {
  eth: ['https://ethereum-rpc.publicnode.com'],
  base: ['https://mainnet.base.org', 'https://base-rpc.publicnode.com'],
  bsc: ['https://bsc-dataseed1.binance.org', 'https://bsc-rpc.publicnode.com'],
  arb: ['https://arb1.arbitrum.io/rpc', 'https://arbitrum-one-rpc.publicnode.com'],
}

/** RPC URLs from the environment: a comma-separated list per chain replaces the defaults. */
export function rpcUrlsFromEnv(env: NodeJS.ProcessEnv = process.env): Record<EvmChain, string[]> {
  const list = (value: string | undefined, fallback: string[]) => {
    const urls = (value ?? '').split(',').map((u) => u.trim()).filter(Boolean)
    return urls.length > 0 ? urls : fallback
  }
  return {
    eth: list(env.ETH_RPC_URL, DEFAULT_RPC_URLS.eth),
    base: list(env.BASE_RPC_URL, DEFAULT_RPC_URLS.base),
    bsc: list(env.BSC_RPC_URL, DEFAULT_RPC_URLS.bsc),
    arb: list(env.ARB_RPC_URL, DEFAULT_RPC_URLS.arb),
  }
}

interface RpcRequest {
  jsonrpc: '2.0'
  id: number
  method: string
  params: unknown[]
}

type RpcOutcome = { ok: true; result: string } | { ok: false; error: ProviderError }

const HEX = /^0x[0-9a-fA-F]*$/

function failure(kind: ProviderError['kind'], message: string): RpcOutcome {
  return { ok: false, error: new ProviderError('evm-rpc', kind, message) }
}

function hexToBigInt(result: string, what: string): bigint {
  // "0x" alone is what a non-contract address answers to eth_call: that is not a zero balance.
  if (result.length <= 2) throw new ProviderError('evm-rpc', 'malformed', `${what}: empty result`)
  return BigInt(result)
}

/** Decodes an ABI-encoded `string`, or a `bytes32` (some old tokens, e.g. MKR). Exported for tests. */
export function decodeSymbol(result: string): string {
  const fail = (why: string) => new ProviderError('evm-rpc', 'malformed', `symbol(): ${why}`)
  const data = result.slice(2)
  if (data.length === 0 || data.length % 2 !== 0) throw fail('empty or odd-length result')
  const bytes = Buffer.from(data, 'hex')

  let raw: Buffer
  if (bytes.length === 32) {
    raw = bytes
  } else if (bytes.length >= 64) {
    const offset = Number(BigInt('0x' + bytes.subarray(0, 32).toString('hex')))
    if (offset !== 32) throw fail('unexpected string offset')
    const length = Number(BigInt('0x' + bytes.subarray(32, 64).toString('hex')))
    if (length > bytes.length - 64) throw fail('string length exceeds the result')
    raw = bytes.subarray(64, 64 + length)
  } else {
    throw fail('unrecognised encoding')
  }

  // Strip NUL padding, then control characters, so a hostile token cannot inject odd text.
  const symbol = raw
    .toString('utf8')
    .replace(/\0+$/, '')
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .trim()
  if (symbol.length === 0) throw fail('empty symbol')
  return symbol.slice(0, MAX_SYMBOL_LENGTH)
}

export function decodeDecimals(result: string): number {
  const value = hexToBigInt(result, 'decimals()')
  if (value > 36n) throw new ProviderError('evm-rpc', 'malformed', `decimals() out of range: ${value}`)
  return Number(value)
}

function padAddress(address: string): string {
  return address.toLowerCase().replace(/^0x/, '').padStart(64, '0')
}

export interface RpcOptions {
  fetch?: FetchLike
  urls?: Partial<Record<EvmChain, string[]>>
  timeoutMs?: number
  concurrency?: number
}

export type RpcBatch = (chain: EvmChain, calls: Array<Pick<RpcRequest, 'method' | 'params'>>) => Promise<RpcOutcome[]>

/** `eth_call` result of one call: the returned hex, or why it failed (a revert is a failure, never an empty value). */
export type CallOutcome = { ok: true; result: string } | { ok: false; error: string }

/** Read-only contract calls on one chain, sent as one batch with the same URL failover as the balance reads. */
export function createEthCall(chain: EvmChain, options: RpcOptions = {}): (calls: Array<{ to: string; data: string }>) => Promise<CallOutcome[]> {
  const batch = createRpcBatch(options)
  return async (calls) => {
    if (calls.length === 0) return []
    const outcomes = await batch(
      chain,
      calls.map((c) => ({ method: 'eth_call', params: [{ to: c.to, data: c.data }, 'latest'] }))
    )
    return outcomes.map((o): CallOutcome => (o.ok ? o : { ok: false, error: o.error.message }))
  }
}

function createRpcBatch(options: RpcOptions): RpcBatch {
  const doFetch = options.fetch ?? fetch
  const urls = { ...rpcUrlsFromEnv(), ...options.urls }
  const limit = createLimiter(options.concurrency ?? 2)

  /** Sends one batch to the first URL that answers, and returns outcomes in request order. */
  return async function batch(chain, calls) {
    const requests: RpcRequest[] = calls.map((c, i) => ({ jsonrpc: '2.0', id: i + 1, ...c }))
    let lastError: ProviderError | undefined

    for (const url of urls[chain]) {
      try {
        const body = await limit(() =>
          fetchJson('evm-rpc', doFetch, url, { method: 'POST', body: requests, timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS })
        )
        if (!Array.isArray(body)) {
          // A single error object (e.g. batching refused) is a provider failure, not a result.
          throw new ProviderError('evm-rpc', 'malformed', 'expected a batch response')
        }
        const byId = new Map<number, unknown>()
        for (const item of body) byId.set((item as { id?: number } | null)?.id as number, item)

        return requests.map((req): RpcOutcome => {
          const item = byId.get(req.id) as { result?: unknown; error?: { message?: unknown } } | undefined
          if (!item) return failure('malformed', `no response for ${req.method}`)
          if (item.error) return failure('rpc', `${req.method}: ${String(item.error.message ?? 'error')}`.slice(0, 200))
          if (typeof item.result !== 'string' || !HEX.test(item.result)) return failure('malformed', `${req.method}: result is not hex`)
          return { ok: true, result: item.result }
        })
      } catch (err) {
        if (!(err instanceof ProviderError)) throw err
        lastError = err
      }
    }
    throw lastError ?? new ProviderError('evm-rpc', 'network', `no RPC URL configured for ${chain}`)
  }
}

export function createEvmRpc(options: RpcOptions = {}): EvmProvider {
  const batch = createRpcBatch(options)

  const callData = (selector: string, address?: string) => (address ? selector + padAddress(address) : selector)

  return {
    async getBalances(chain, address, tokens: TokenRef[]): Promise<EvmBalances> {
      const outcomes = await batch(chain, [
        { method: 'eth_getBalance', params: [address, 'latest'] },
        ...tokens.map((t) => ({
          method: 'eth_call',
          params: [{ to: t.contract, data: callData(BALANCE_OF, address) }, 'latest'],
        })),
      ])

      // The native balance is required: without it the whole address is a failure.
      const [native, ...rest] = outcomes
      if (!native.ok) throw native.error
      let nativeBalance: Decimal
      try {
        nativeBalance = fromBaseUnits(hexToBigInt(native.result, 'eth_getBalance'), 18)
      } catch (err) {
        throw err instanceof ProviderError ? err : new ProviderError('evm-rpc', 'malformed', 'eth_getBalance: bad result')
      }

      const result: Record<string, TokenBalance> = {}
      tokens.forEach((token, i) => {
        const outcome = rest[i]
        if (!outcome.ok) {
          result[token.contract] = outcome
          return
        }
        try {
          result[token.contract] = { ok: true, balance: fromBaseUnits(hexToBigInt(outcome.result, 'balanceOf'), token.decimals) }
        } catch (err) {
          result[token.contract] = {
            ok: false,
            error: err instanceof ProviderError ? err : new ProviderError('evm-rpc', 'malformed', 'balanceOf: bad result'),
          }
        }
      })
      return { native: nativeBalance, tokens: result }
    },

    async getTokenMetadata(chain, contract): Promise<TokenMetadata> {
      const [decimals, symbol] = await batch(chain, [
        { method: 'eth_call', params: [{ to: contract, data: DECIMALS }, 'latest'] },
        { method: 'eth_call', params: [{ to: contract, data: SYMBOL }, 'latest'] },
      ])
      if (!decimals.ok) throw decimals.error
      if (!symbol.ok) throw symbol.error
      return { decimals: decodeDecimals(decimals.result), symbol: decodeSymbol(symbol.result) }
    },
  }
}
