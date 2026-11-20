import { dec, type Decimal } from '../../../lib/money'
import { createLimiter, fetchJson, type FetchLike } from './http'
import { ProviderError, type EvmChain } from './types'

const PROVIDER = 'blockscout'
// Big wallets take about 25 s to answer (see docs/providers.md), so this is deliberately generous.
export const SCAN_TIMEOUT_MS = 60_000
const MAX_SYMBOL_LENGTH = 32
const MAX_NAME_LENGTH = 64
const CONTRACT = /^0x[0-9a-fA-F]{40}$/

/** One ERC-20 balance found by a scan. Provider-sourced strings are sanitised and length-capped here. */
export interface ScanToken {
  /** Lowercase contract address. */
  contract: string
  symbol: string
  name: string
  decimals: number
  balance: Decimal
  /** USD price from the provider, or null when it has none (the token is "unpriced"). */
  priceUsd: Decimal | null
  /** Provider reputation flag. Anything other than "ok" is treated as spam. */
  reputation: string | null
}

export type ScanSupport = { enabled: true } | { enabled: false; reason: string }

export interface ScanProvider {
  support(chain: EvmChain): ScanSupport
  listTokens(chain: EvmChain, address: string): Promise<ScanToken[]>
  /** Set by listTokens when prices could not be fetched, so "unpriced" means "lookup failed", not "worthless". Optional. */
  pricesUnavailable?: (chain: EvmChain, address: string) => boolean
}

function cleanText(value: unknown, max: number): string {
  if (typeof value !== 'string') return ''
  return value.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, max)
}

function parseItem(item: unknown): ScanToken | null {
  const entry = item as { token?: Record<string, unknown> | null; value?: unknown } | null
  const token = entry?.token
  // NFTs and other standards are out of scope. A malformed entry is skipped, it must not fail the whole scan.
  if (!token || token.type !== 'ERC-20') return null
  if (typeof token.address_hash !== 'string' || !CONTRACT.test(token.address_hash)) return null
  if (typeof entry?.value !== 'string' || !/^\d+$/.test(entry.value)) return null

  const decimals = Number(token.decimals)
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 36) return null

  let priceUsd: Decimal | null = null
  if (token.exchange_rate !== null && token.exchange_rate !== undefined) {
    try {
      const price = dec(token.exchange_rate as string | number)
      priceUsd = price.isPositive() && !price.isZero() ? price : null
    } catch {
      priceUsd = null
    }
  }

  return {
    contract: token.address_hash.toLowerCase(),
    symbol: cleanText(token.symbol, MAX_SYMBOL_LENGTH) || '?',
    name: cleanText(token.name, MAX_NAME_LENGTH),
    decimals,
    balance: dec(entry.value).div(dec(10).pow(decimals)),
    priceUsd,
    reputation: typeof token.reputation === 'string' ? token.reputation : null,
  }
}

/** Parses a keyless `token-balances` array or a keyed `{ items }` page. Exported for tests. */
export function parseTokenBalances(payload: unknown): ScanToken[] {
  const items = Array.isArray(payload) ? payload : (payload as { items?: unknown } | null)?.items
  if (!Array.isArray(items)) throw new ProviderError(PROVIDER, 'malformed', 'expected a list of token balances')
  return items.map(parseItem).filter((t): t is ScanToken => t !== null)
}

export function createBlockscout(options: { fetch?: FetchLike; timeoutMs?: number; ethBaseUrl?: string } = {}): ScanProvider {
  const doFetch = options.fetch ?? fetch
  const timeoutMs = options.timeoutMs ?? SCAN_TIMEOUT_MS
  const ethBase = (options.ethBaseUrl ?? 'https://eth.blockscout.com').replace(/\/+$/, '')
  // Scans are interactive and rare. One at a time keeps the load on the provider small.
  const limit = createLimiter(1)

  return {
    support(chain) {
      return chain === 'eth' ? { enabled: true } : { enabled: false, reason: 'Blockscout is only used for the Ethereum scan.' }
    },

    listTokens(chain, address) {
      return limit(async () => {
        if (chain !== 'eth') throw new ProviderError(PROVIDER, 'malformed', `no scan for ${chain}`)
        return parseTokenBalances(
          await fetchJson(PROVIDER, doFetch, `${ethBase}/api/v2/addresses/${address}/token-balances`, { timeoutMs })
        )
      })
    },
  }
}
