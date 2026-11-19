import { api } from './api'

export type Chain = 'btc' | 'eth' | 'base'

export const CHAIN_LABEL: Record<Chain, string> = { btc: 'Bitcoin', eth: 'Ethereum', base: 'Base' }

export interface AddressLastValue {
  usd: string
  eur: string
  date: string
  stale: boolean
}

export interface CryptoAddress {
  id: string
  label: string | null
  chain: Chain
  address: string
  active: boolean
  createdAt: string
  lastValue: AddressLastValue | null
}

const BASE = '/api/admin/crypto'

export const cryptoApi = {
  listAddresses: () => api<{ addresses: CryptoAddress[] }>(`${BASE}/addresses`).then((r) => r.addresses),
  addAddress: (body: { chain: Chain; address: string; label?: string }) =>
    api<CryptoAddress>(`${BASE}/addresses`, { method: 'POST', body }),
  updateAddress: (id: string, body: { label?: string | null; active?: boolean }) =>
    api<CryptoAddress>(`${BASE}/addresses/${encodeURIComponent(id)}`, { method: 'PATCH', body }),
  deleteAddress: (id: string) => api(`${BASE}/addresses/${encodeURIComponent(id)}`, { method: 'DELETE' }),
}

/** Decimal string to a display amount. Display only, never used for arithmetic. */
export function formatMoney(value: string, currency: 'USD' | 'EUR'): string {
  return new Intl.NumberFormat('en', { style: 'currency', currency, maximumFractionDigits: 2 }).format(Number(value))
}

/** 0xabcd…1234 for display. The full address stays available in the title and on copy. */
export function shortAddress(address: string): string {
  return address.length > 20 ? `${address.slice(0, 8)}…${address.slice(-6)}` : address
}
