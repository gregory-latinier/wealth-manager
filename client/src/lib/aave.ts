import { api } from './api'

export interface AaveLastValue {
  usd: string
  eur: string
  date: string
  stale: boolean
}

export interface AaveWallet {
  id: string
  label: string
  address: string
  active: boolean
  createdAt: string
  /** Net value in the latest snapshot: what is supplied minus what is owed. */
  lastValue: AaveLastValue | null
}

/** One reserve of a wallet, read live from the chain. Numbers are fixed-point strings; usd is null when the asset has no price. */
export interface AaveReserve {
  reserveId: number
  symbol: string
  supplied: string
  debt: string
  suppliedUsd: string | null
  debtUsd: string | null
}

export interface AaveWalletPositions {
  reserves: AaveReserve[]
  /** Collateral over debt. Below 1 the position can be liquidated. Null when nothing is borrowed. */
  healthFactor: string | null
  warnings: string[]
}

const BASE = '/api/admin/aave'

export const aaveApi = {
  list: () => api<{ wallets: AaveWallet[] }>(`${BASE}/wallets`),
  add: (body: { label: string; address: string }) => api<AaveWallet>(`${BASE}/wallets`, { method: 'POST', body }),
  update: (id: string, body: { label?: string; active?: boolean }) => api<AaveWallet>(`${BASE}/wallets/${encodeURIComponent(id)}`, { method: 'PATCH', body }),
  positions: (id: string) => api<AaveWalletPositions>(`${BASE}/wallets/${encodeURIComponent(id)}/positions`),
  remove: (id: string) => api(`${BASE}/wallets/${encodeURIComponent(id)}`, { method: 'DELETE' }),
}
