import { api } from './api'

export interface SmardexLastValue {
  usd: string
  eur: string
  date: string
  stale: boolean
}

export interface SmardexWallet {
  id: string
  label: string
  address: string
  active: boolean
  createdAt: string
  lastValue: SmardexLastValue | null
}

/** One open position, read live from the chain. Numbers are fixed-point strings; null means it could not be worked out. */
export interface SmardexPosition {
  tick: number
  tickVersion: string
  index: string
  openedAt: string | null
  collateral: string | null
  size: string | null
  leverage: string | null
  entryPriceUsd: string | null
  liquidationPriceUsd: string | null
  valueWstEth: string | null
  valueUsd: string | null
  pnlWstEth: string | null
  pnlWstEthPct: string | null
  pnlUsd: string | null
  pnlUsdPct: string | null
  error: string | null
}

export interface SmardexWalletPositions {
  wstEthUsd: string | null
  positions: SmardexPosition[]
  warnings: string[]
}

const BASE = '/api/admin/smardex'

export const smardexApi = {
  list: () => api<{ wallets: SmardexWallet[] }>(`${BASE}/wallets`),
  add: (body: { label: string; address: string }) => api<SmardexWallet>(`${BASE}/wallets`, { method: 'POST', body }),
  update: (id: string, body: { label?: string; active?: boolean }) =>
    api<SmardexWallet>(`${BASE}/wallets/${encodeURIComponent(id)}`, { method: 'PATCH', body }),
  positions: (id: string) => api<SmardexWalletPositions>(`${BASE}/wallets/${encodeURIComponent(id)}/positions`),
  remove: (id: string) => api(`${BASE}/wallets/${encodeURIComponent(id)}`, { method: 'DELETE' }),
}
