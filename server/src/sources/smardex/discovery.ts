import { createLimiter, DEFAULT_TIMEOUT_MS, fetchJson, type FetchLike } from '../crypto/providers/http'
import { ProviderError } from '../crypto/providers/types'
import { LONG_FARMING, PROTOCOL, UNIVERSAL_ROUTER, parsePositionEvent, positionKey, toChecksumAddress, type DiscoveredPosition, type OwnedPositionEvent } from './abi'

const PROVIDER = 'blockscout'
// Transactions are listed 50 per page, so this reads up to 10 000 of them in one scan. More than that is reported, not skipped.
const MAX_TX_PAGES = 200
const MAX_LOG_PAGES = 10
// Calls that can open a position or move its ownership: the protocol itself, the router front ends use, and the farming contract.
const RELEVANT_TARGETS = new Set([PROTOCOL, UNIVERSAL_ROUTER, LONG_FARMING])

export interface DiscoveryResult {
  /**
   * Positions the address was handed by transactions newer than `since`, with the date and price of their opening when
   * those transactions include it. Whether they are still open is read live.
   */
  positions: DiscoveredPosition[]
  /** Newest transaction read, to start the next scan from. Null when the address has no transaction at all. */
  newest: string | null
}

export interface PositionHistory {
  /** Reads the address's outgoing transactions, newest first, until `since` (exclusive) or the beginning. */
  findNew(address: string, since: string | null): Promise<DiscoveryResult>
}

interface PagedResponse {
  items?: unknown
  next_page_params?: Record<string, unknown> | null
}

interface TxItem {
  hash?: string
  status?: string | null
  block_number?: number | null
  to?: { hash?: string } | null
}

interface LogItem {
  address?: { hash?: string } | null
  topics?: Array<string | null>
  data?: string
}

const cursorOf = (next: Record<string, unknown> | null | undefined) =>
  next ? '?' + Object.entries(next).map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`).join('&') : null

export function createBlockscoutHistory(options: { fetch?: FetchLike; baseUrl?: string; timeoutMs?: number } = {}): PositionHistory {
  const doFetch = options.fetch ?? fetch
  const base = (options.baseUrl ?? 'https://eth.blockscout.com').replace(/\/+$/, '') + '/api/v2'
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS * 2
  const limit = createLimiter(2)

  async function page(path: string): Promise<PagedResponse> {
    const body = await limit(() => fetchJson(PROVIDER, doFetch, `${base}${path}`, { timeoutMs }))
    if (typeof body !== 'object' || body === null || !Array.isArray((body as PagedResponse).items)) {
      throw new ProviderError(PROVIDER, 'malformed', `${path.split('?')[0]}: no items`)
    }
    return body as PagedResponse
  }

  async function logsOf(hash: string, address: string): Promise<OwnedPositionEvent[]> {
    const found: OwnedPositionEvent[] = []
    let cursor = ''
    for (let i = 0; i < MAX_LOG_PAGES; i++) {
      const res = await page(`/transactions/${hash}/logs${cursor}`)
      for (const log of res.items as LogItem[]) {
        // Only the protocol's own events count: any contract can emit an event with the same shape.
        if (log.address?.hash?.toLowerCase() !== PROTOCOL || !log.topics || typeof log.data !== 'string') continue
        const event = parsePositionEvent(log.topics, log.data)
        if (event && event.owner === address) found.push(event)
      }
      const next = cursorOf(res.next_page_params)
      if (!next) return found
      cursor = next
    }
    throw new ProviderError(PROVIDER, 'malformed', `transaction ${hash} has more than ${MAX_LOG_PAGES} pages of logs`)
  }

  return {
    async findNew(address, since) {
      const relevant: string[] = []
      let newest: string | null = null
      let cursor = ''
      let reachedSince = false

      for (let i = 0; i < MAX_TX_PAGES && !reachedSince; i++) {
        // The cursor Blockscout returns already contains `filter=from`.
        const res = await page(`/addresses/${toChecksumAddress(address)}/transactions${cursor || '?filter=from'}`)
        for (const tx of res.items as TxItem[]) {
          if (!tx.hash) continue
          if (tx.hash === since) {
            reachedSince = true
            break
          }
          // A transaction still in the mempool has no block yet. It is picked up once it is mined.
          if (tx.block_number == null) continue
          newest ??= tx.hash
          const target = tx.to?.hash?.toLowerCase()
          if (tx.status === 'ok' && target && RELEVANT_TARGETS.has(target)) relevant.push(tx.hash)
        }
        const next = cursorOf(res.next_page_params)
        if (!next) {
          reachedSince = true
        } else {
          cursor = next
        }
      }
      if (!reachedSince) throw new ProviderError(PROVIDER, 'malformed', `more than ${MAX_TX_PAGES * 50} transactions to read`)

      // Oldest first, so the result reads in the order things happened.
      // A position is opened in two steps: the initiation carries the date, the validation carries the final entry price.
      const byKey = new Map<string, DiscoveredPosition>()
      for (const hash of relevant.reverse()) {
        for (const event of await logsOf(hash, address)) {
          const key = positionKey(event.posId)
          const known = byKey.get(key)
          const openedAt = known?.openedAt ?? event.opening?.openedAt
          const entryPrice = event.validated ? (event.opening?.entryPrice ?? known?.entryPrice) : (known?.entryPrice ?? event.opening?.entryPrice)
          byKey.set(key, { ...event.posId, ...(openedAt !== undefined && { openedAt }), ...(entryPrice !== undefined && { entryPrice }) })
        }
      }
      return { positions: [...byKey.values()], newest }
    },
  }
}
