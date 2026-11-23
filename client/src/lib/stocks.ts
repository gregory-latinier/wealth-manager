import { api } from './api'

export interface StockLastValue {
  usd: string
  eur: string
  date: string
  stale: boolean
}

export interface StockHolding {
  id: string
  /** Yahoo Finance ticker of the listing, for example JEQP.DE. */
  symbol: string
  name: string
  /** Where it is held. Empty when not given. */
  broker: string
  /** Currency the listing is quoted in. */
  currency: 'EUR' | 'USD'
  /** Fixed-point string with 6 decimals, as stored. */
  quantity: string
  active: boolean
  createdAt: string
  lastValue: StockLastValue | null
}

/** A listing found by name. Currency and price are null when its quote could not be read. */
export interface SearchResult {
  symbol: string
  name: string
  /** ETF, EQUITY or MUTUALFUND. */
  type: string
  exchange: string
  currency: string | null
  /** Last price in `currency`. */
  price: string | null
  /** True when it can be added: quoted in EUR or USD. */
  supported: boolean
  /** Why it cannot be added. */
  reason: string | null
}

const BASE = '/api/admin/stocks'

export const stocksApi = {
  /** Listings that can be added come first. */
  search: (text: string) => api<{ results: SearchResult[] }>(`${BASE}/search?q=${encodeURIComponent(text)}`),
  list: () => api<{ holdings: StockHolding[] }>(`${BASE}/holdings`),
  /** The name and currency are read from the listing by the server. */
  add: (body: { symbol: string; broker?: string; quantity: string }) => api<StockHolding>(`${BASE}/holdings`, { method: 'POST', body }),
  /** The ticker and currency cannot be changed. */
  update: (id: string, body: { broker?: string; quantity?: string; active?: boolean }) =>
    api<StockHolding>(`${BASE}/holdings/${encodeURIComponent(id)}`, { method: 'PATCH', body }),
  remove: (id: string) => api(`${BASE}/holdings/${encodeURIComponent(id)}`, { method: 'DELETE' }),
}
