import crypto from 'crypto'
import { dec, type Decimal } from '../../lib/money'
import { DEFAULT_TIMEOUT_MS, fetchJson, type FetchLike } from '../crypto/providers/http'
import { ProviderError } from '../crypto/providers/types'
import type { Credentials, ExchangeAdapter, ExchangeBalance } from './types'

const PROVIDER = 'kraken'
const BASE_URL = 'https://api.kraken.com'
const PAIRS_PER_TICKER_CALL = 40

/** Kraken signs `path + SHA256(nonce + postdata)` with HMAC-SHA512 and the base64-decoded secret. Exported for tests. */
export function sign(path: string, nonce: string, postData: string, apiSecret: string): string {
  const hash = crypto.createHash('sha256').update(nonce + postData).digest()
  return crypto
    .createHmac('sha512', Buffer.from(apiSecret, 'base64'))
    .update(Buffer.concat([Buffer.from(path, 'utf8'), hash]))
    .digest('base64')
}

// Kraken's legacy codes carry an X (crypto) or Z (fiat) prefix. A rule like "strip a leading X or Z" would turn
// ZETA into ETA, so the legacy ones are listed. Everything else is already the plain symbol.
const LEGACY: Record<string, string> = {
  XXBT: 'BTC',
  XBT: 'BTC',
  XETH: 'ETH',
  XXRP: 'XRP',
  XLTC: 'LTC',
  XXLM: 'XLM',
  XXDG: 'DOGE',
  XDG: 'DOGE',
  XETC: 'ETC',
  XXMR: 'XMR',
  XZEC: 'ZEC',
  XMLN: 'MLN',
  XREP: 'REP',
  ZUSD: 'USD',
  ZEUR: 'EUR',
  ZGBP: 'GBP',
  ZCAD: 'CAD',
  ZJPY: 'JPY',
  ZAUD: 'AUD',
}

/**
 * The plain symbol of a Kraken asset code. A suffix says how the balance is held (`.S` staked, `.M` opt-in
 * rewards, `.F` auto-earn, `.B` yield bearing, `.P` parachain), not what it is, so it is dropped: staked ETH is ETH.
 * `ETH2` (the old staked ETH) is priced as ETH. Exported for tests.
 */
export function normalizeAsset(code: string): string {
  const base = code.replace(/\.(S|M|F|B|P)$/, '')
  if (base === 'ETH2') return 'ETH'
  return LEGACY[base] ?? base
}

interface AssetPair {
  base: string
  quote: string
  wsname?: string
  status: string
}

function parseBody<T>(body: unknown): T {
  const b = body as { error?: unknown; result?: unknown } | null
  if (!b || typeof b !== 'object') throw new ProviderError(PROVIDER, 'malformed', 'expected a JSON object')
  if (Array.isArray(b.error) && b.error.length > 0) {
    // Kraken answers 200 with an error list. Only the error codes are shown, never the request.
    throw new ProviderError(PROVIDER, 'rpc', b.error.map((e) => String(e)).join(', ').slice(0, 200))
  }
  if (!b.result || typeof b.result !== 'object') throw new ProviderError(PROVIDER, 'malformed', 'no result in the answer')
  return b.result as T
}

export function createKraken(options: { fetch?: FetchLike; baseUrl?: string; timeoutMs?: number; now?: () => number } = {}): ExchangeAdapter {
  const doFetch = options.fetch ?? fetch
  const baseUrl = (options.baseUrl ?? BASE_URL).replace(/\/+$/, '')
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
  // The nonce must grow on every call for one key. Microseconds, and never backwards within this process.
  let lastNonce = 0
  const nextNonce = () => {
    lastNonce = Math.max(lastNonce + 1, (options.now?.() ?? Date.now()) * 1000)
    return String(lastNonce)
  }

  async function publicGet<T>(path: string): Promise<T> {
    return parseBody<T>(await fetchJson(PROVIDER, doFetch, `${baseUrl}${path}`, { timeoutMs }))
  }

  async function privatePost<T>(path: string, credentials: Credentials): Promise<T> {
    const nonce = nextNonce()
    const form = new URLSearchParams({ nonce }).toString()
    const body = await fetchJson(PROVIDER, doFetch, `${baseUrl}${path}`, {
      method: 'POST',
      form,
      headers: { 'API-Key': credentials.apiKey, 'API-Sign': sign(path, nonce, form, credentials.apiSecret) },
      timeoutMs,
    })
    return parseBody<T>(body)
  }

  /** USD price per symbol from the public tickers. A symbol without an online USD pair is simply absent. */
  async function usdPrices(symbols: string[]): Promise<Map<string, Decimal>> {
    const prices = new Map<string, Decimal>()
    if (symbols.length === 0) return prices

    const pairs = await publicGet<Record<string, AssetPair>>('/0/public/AssetPairs')
    // Keyed by the pair name Kraken itself uses, which is also the key of its Ticker answer.
    const pairOf = new Map<string, string>()
    for (const [name, p] of Object.entries(pairs)) {
      if (p.status !== 'online' || normalizeAsset(p.quote) !== 'USD') continue
      pairOf.set(normalizeAsset(p.base), name)
    }

    const wanted = symbols.flatMap((symbol) => {
      const pair = pairOf.get(symbol)
      return pair ? [{ symbol, pair }] : []
    })
    for (let i = 0; i < wanted.length; i += PAIRS_PER_TICKER_CALL) {
      const chunk = wanted.slice(i, i + PAIRS_PER_TICKER_CALL)
      const tickers = await publicGet<Record<string, { c?: [string, string] }>>(
        `/0/public/Ticker?pair=${chunk.map((w) => w.pair).join(',')}`
      )
      for (const w of chunk) {
        const last = tickers[w.pair]?.c?.[0]
        const price = last === undefined ? undefined : dec(last)
        if (price && price.gt(0)) prices.set(w.symbol, price)
      }
    }
    return prices
  }

  return {
    id: 'kraken',

    async verify(credentials) {
      await privatePost('/0/private/Balance', credentials)
    },

    async getBalances(credentials): Promise<ExchangeBalance[]> {
      const raw = await privatePost<Record<string, string>>('/0/private/Balance', credentials)

      // Staked, auto-earn and plain balances of one asset add up to one line per symbol.
      const totals = new Map<string, Decimal>()
      for (const [code, value] of Object.entries(raw)) {
        const amount = dec(value)
        if (amount.lte(0)) continue
        const symbol = normalizeAsset(code)
        totals.set(symbol, (totals.get(symbol) ?? dec(0)).plus(amount))
      }

      const prices = await usdPrices([...totals.keys()].filter((s) => s !== 'USD'))
      return [...totals].map(([symbol, amount]) => ({
        ref: symbol,
        symbol,
        amount,
        priceUsd: symbol === 'USD' ? dec(1) : (prices.get(symbol) ?? null),
      }))
    },
  }
}
