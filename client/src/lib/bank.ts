import { api } from './api'

export type BankCurrency = 'EUR' | 'USD'

export interface BankLastValue {
  usd: string
  eur: string
  date: string
  stale: boolean
}

export interface BankAccount {
  id: string
  name: string
  /** The institution. Empty when not given. */
  bank: string
  currency: BankCurrency
  /** Fixed-point string with 2 decimals, as stored. Negative for an overdraft. */
  balance: string
  active: boolean
  createdAt: string
  lastValue: BankLastValue | null
}

const BASE = '/api/admin/bank'

export const bankApi = {
  list: () => api<{ accounts: BankAccount[] }>(`${BASE}/accounts`),
  add: (body: { name: string; bank?: string; currency: BankCurrency; balance: string }) => api<BankAccount>(`${BASE}/accounts`, { method: 'POST', body }),
  /** The currency cannot be changed. */
  update: (id: string, body: { name?: string; bank?: string; balance?: string; active?: boolean }) =>
    api<BankAccount>(`${BASE}/accounts/${encodeURIComponent(id)}`, { method: 'PATCH', body }),
  remove: (id: string) => api(`${BASE}/accounts/${encodeURIComponent(id)}`, { method: 'DELETE' }),
}
