import { api } from './api'

export type ExchangeId = 'kraken' | 'okx'

export interface ExchangeInfo {
  id: ExchangeId
  label: string
}

export interface ExchangeLastValue {
  usd: string
  eur: string
  date: string
  stale: boolean
}

/** An account as the server describes it. The API key and secret never come back, only whether the account is active. */
export interface ExchangeAccount {
  id: string
  exchange: ExchangeId
  label: string
  active: boolean
  createdAt: string
  lastValue: ExchangeLastValue | null
}

export interface ExchangeList {
  /** False when the server has no EXCHANGE_KEY_SECRET, so keys cannot be stored. */
  ready: boolean
  exchanges: ExchangeInfo[]
  accounts: ExchangeAccount[]
}

export interface ExchangeCredentials {
  apiKey: string
  apiSecret: string
  passphrase?: string
}

const BASE = '/api/admin/exchanges'

export const exchangeApi = {
  list: () => api<ExchangeList>(`${BASE}/accounts`),
  add: (body: { exchange: ExchangeId; label: string; credentials: ExchangeCredentials }) =>
    api<ExchangeAccount>(`${BASE}/accounts`, { method: 'POST', body }),
  update: (id: string, body: { label?: string; active?: boolean; credentials?: ExchangeCredentials }) =>
    api<ExchangeAccount>(`${BASE}/accounts/${encodeURIComponent(id)}`, { method: 'PATCH', body }),
  remove: (id: string) => api(`${BASE}/accounts/${encodeURIComponent(id)}`, { method: 'DELETE' }),
}

/** What to do in each exchange's website to get a key that can only read. Shown in the form. */
export const KEY_HELP: Record<ExchangeId, string> = {
  kraken: 'In Kraken: Security > API > Create API key. Tick only "Query funds". Leave trading, deposit and withdrawal off.',
  okx: 'In OKX: API > Create API key. Choose "Read only" and note the passphrase you set.',
}
