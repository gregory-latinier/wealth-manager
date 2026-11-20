import { api } from './api'

export type Chain = 'btc' | 'eth' | 'base' | 'bsc'
export type EvmChain = Exclude<Chain, 'btc'>

export const CHAIN_LABEL: Record<Chain, string> = { btc: 'Bitcoin', eth: 'Ethereum', base: 'Base', bsc: 'BNB Chain' }

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

export interface ScanEntry {
  contract: string
  symbol: string
  name: string
  decimals: number
  balance: string
  priceUsd: string | null
  valueUsd: string | null
  tracked: boolean
}

export interface HiddenEntry extends ScanEntry {
  hiddenReason: 'ignored' | 'spam'
}

export type ScanResult =
  | { status: 'disabled'; reason: string }
  | { status: 'ok'; thresholdUsd: string; selectable: ScanEntry[]; unpriced: ScanEntry[]; hidden: HiddenEntry[]; belowThresholdCount: number; pricesUnavailable: boolean }

export interface TrackedToken {
  id: string
  addressId: string
  symbol: string
  contractAddress: string
  decimals: number
  active: boolean
  createdAt: string
}

export interface AddedToken extends TrackedToken {
  /** null when the price check itself failed. */
  priced: boolean | null
  warning: string | null
}

export interface IgnoredToken {
  id: string
  chain: EvmChain
  contractAddress: string
}

const addr = (id: string) => `${BASE}/addresses/${encodeURIComponent(id)}`

export const tokenApi = {
  scan: (addressId: string) => api<ScanResult>(`${addr(addressId)}/scan`, { method: 'POST' }),
  list: (addressId: string) => api<{ tokens: TrackedToken[] }>(`${addr(addressId)}/tokens`).then((r) => r.tokens),
  add: (addressId: string, contractAddress: string) => api<AddedToken>(`${addr(addressId)}/tokens`, { method: 'POST', body: { contractAddress } }),
  setActive: (addressId: string, tokenId: string, active: boolean) =>
    api<TrackedToken>(`${addr(addressId)}/tokens/${encodeURIComponent(tokenId)}`, { method: 'PATCH', body: { active } }),
  remove: (addressId: string, tokenId: string) => api(`${addr(addressId)}/tokens/${encodeURIComponent(tokenId)}`, { method: 'DELETE' }),
  getThreshold: () => api<{ scanThresholdUsd: string }>(`${BASE}/settings`).then((r) => r.scanThresholdUsd),
  setThreshold: (scanThresholdUsd: string) => api<{ scanThresholdUsd: string }>(`${BASE}/settings`, { method: 'PUT', body: { scanThresholdUsd } }),
  listIgnored: () => api<{ ignored: IgnoredToken[] }>(`${BASE}/ignored-tokens`).then((r) => r.ignored),
  ignore: (chain: EvmChain, contractAddress: string) => api<IgnoredToken>(`${BASE}/ignored-tokens`, { method: 'POST', body: { chain, contractAddress } }),
  unignore: (id: string) => api(`${BASE}/ignored-tokens/${encodeURIComponent(id)}`, { method: 'DELETE' }),
}
