import { dec, type Decimal } from '../../lib/money'
import { DEFAULT_TIMEOUT_MS, fetchJson, type FetchLike } from '../crypto/providers/http'
import { ProviderError } from '../crypto/providers/types'

const PROVIDER = 'yahoo'
const BASE_URL = 'https://query1.finance.yahoo.com/v8/finance/chart/'
// A listing whose last trade is older than this is delisted or suspended, so its price is not trusted as current.
const MAX_AGE_DAYS = 14

export interface Quote {
  symbol: string
  name: string
  /** Currency the price is in, as reported by the exchange, for example EUR or GBp (pence). */
  currency: string
  /** Last price. Always positive. */
  price: Decimal
  /** When that price was traded. */
  time: Date
}

export interface QuoteProvider {
  getQuote(symbol: string): Promise<Quote>
}

/** The provider has no such ticker. Not a failure of the provider, so the caller can tell the owner to check the symbol. */
export class UnknownSymbolError extends Error {
  constructor(public readonly symbol: string) {
    super(`No listing found for ${symbol}`)
    this.name = 'UnknownSymbolError'
  }
}

/** Parses a Yahoo `v8/finance/chart` payload. Exported for tests. */
export function parseChart(payload: unknown, symbol: string, now: Date = new Date()): Quote {
  const chart = (payload as { chart?: { result?: unknown; error?: { code?: string } | null } } | null)?.chart
  if (!chart || typeof chart !== 'object') throw new ProviderError(PROVIDER, 'malformed', 'expected a "chart" object')
  const result = Array.isArray(chart.result) ? (chart.result[0] as { meta?: Record<string, unknown> } | undefined) : undefined
  if (!result) {
    if (chart.error?.code === 'Not Found') throw new UnknownSymbolError(symbol)
    throw new ProviderError(PROVIDER, 'malformed', `no result for ${symbol}`)
  }
  const meta = result.meta
  const price = meta?.regularMarketPrice
  const time = meta?.regularMarketTime
  if (typeof meta?.currency !== 'string' || !meta.currency) throw new ProviderError(PROVIDER, 'malformed', `no currency for ${symbol}`)
  if (typeof price !== 'number' || !Number.isFinite(price) || price <= 0) throw new ProviderError(PROVIDER, 'malformed', `no valid price for ${symbol}`)
  if (typeof time !== 'number' || !Number.isFinite(time)) throw new ProviderError(PROVIDER, 'malformed', `no trade time for ${symbol}`)

  const traded = new Date(time * 1000)
  if (now.getTime() - traded.getTime() > MAX_AGE_DAYS * 86_400_000) {
    throw new ProviderError(PROVIDER, 'malformed', `last trade of ${symbol} was on ${traded.toISOString().slice(0, 10)}, too old to be a current price`)
  }
  const name = typeof meta.longName === 'string' && meta.longName ? meta.longName : typeof meta.shortName === 'string' && meta.shortName ? meta.shortName : symbol
  return { symbol, name, currency: meta.currency, price: dec(String(price)), time: traded }
}

/** Keyless quotes from the public Yahoo Finance chart endpoint. It is unofficial, so a change on their side shows up as a failure, never as a wrong price. */
export function createYahooQuotes(options: { fetch?: FetchLike; baseUrl?: string; timeoutMs?: number; now?: () => Date } = {}): QuoteProvider {
  const doFetch = options.fetch ?? fetch
  const baseUrl = options.baseUrl ?? BASE_URL
  const now = options.now ?? (() => new Date())

  return {
    async getQuote(symbol) {
      const url = `${baseUrl}${encodeURIComponent(symbol)}?range=5d&interval=1d`
      let body: unknown
      try {
        // Yahoo refuses requests without a browser-like User-Agent.
        body = await fetchJson(PROVIDER, doFetch, url, { headers: { 'User-Agent': 'Mozilla/5.0' }, timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS })
      } catch (err) {
        // An unknown ticker is answered with HTTP 404.
        if (err instanceof ProviderError && err.kind === 'http' && err.message.endsWith('HTTP 404')) throw new UnknownSymbolError(symbol)
        throw err
      }
      return parseChart(body, symbol, now())
    },
  }
}

export interface SearchHit {
  symbol: string
  name: string
  /** Yahoo type: ETF, EQUITY or MUTUALFUND. */
  type: string
  /** Display name of the exchange, for example XETRA. */
  exchange: string
}

export interface SymbolSearch {
  search(text: string): Promise<SearchHit[]>
}

const SEARCH_URL = 'https://query1.finance.yahoo.com/v1/finance/search'
// Indexes, currencies, futures and crypto are not shares. Only these can be held and valued by quantity.
const HOLDABLE = new Set(['ETF', 'EQUITY', 'MUTUALFUND'])

/** Parses a Yahoo `v1/finance/search` payload. Entries that are not shares or have no symbol are left out. Exported for tests. */
export function parseSearch(payload: unknown): SearchHit[] {
  const quotes = (payload as { quotes?: unknown } | null)?.quotes
  if (!Array.isArray(quotes)) throw new ProviderError(PROVIDER, 'malformed', 'expected a "quotes" array')
  const hits: SearchHit[] = []
  for (const q of quotes as Array<Record<string, unknown>>) {
    if (typeof q?.symbol !== 'string' || !q.symbol || typeof q.quoteType !== 'string' || !HOLDABLE.has(q.quoteType)) continue
    const symbol = q.symbol.toUpperCase()
    const name = [q.longname, q.shortname].find((n): n is string => typeof n === 'string' && n !== '') ?? symbol
    const exchange = [q.exchDisp, q.exchange].find((e): e is string => typeof e === 'string' && e !== '') ?? ''
    hits.push({ symbol, name, type: q.quoteType, exchange })
  }
  return hits
}

/** Finds listings by name, ticker or ISIN. Same keyless Yahoo Finance service as the quotes. */
export function createYahooSearch(options: { fetch?: FetchLike; baseUrl?: string; timeoutMs?: number } = {}): SymbolSearch {
  const doFetch = options.fetch ?? fetch
  const baseUrl = options.baseUrl ?? SEARCH_URL

  return {
    async search(text) {
      const url = `${baseUrl}?q=${encodeURIComponent(text)}&quotesCount=10&newsCount=0&listsCount=0`
      const body = await fetchJson(PROVIDER, doFetch, url, { headers: { 'User-Agent': 'Mozilla/5.0' }, timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS })
      return parseSearch(body)
    },
  }
}
