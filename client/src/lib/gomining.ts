import { api } from './api'

export type ThCurrency = 'EUR' | 'USD'

export interface GominingLastValue {
  usd: string
  eur: string
  date: string
  stale: boolean
}

export interface GominingMiner {
  id: string
  name: string
  /** Computing power in TH/s. */
  th: string
  active: boolean
  lastValue: GominingLastValue | null
}

export interface GominingSettings {
  /** What one TH is worth, in `thCurrency`. Null until the owner sets it. */
  thPrice: string | null
  thCurrency: ThCurrency
  btc: string
  gmt: string
}

export interface GominingOverview {
  miners: GominingMiner[]
  settings: GominingSettings
  wallet: { btc: GominingLastValue | null; gmt: GominingLastValue | null }
}

const BASE = '/api/admin/gomining'

export const gominingApi = {
  overview: () => api<GominingOverview>(`${BASE}/`),
  /** Only the fields sent change. An empty `thPrice` forgets it. */
  saveSettings: (body: { thPrice?: string; thCurrency?: ThCurrency; btc?: string; gmt?: string }) => api<GominingSettings>(`${BASE}/settings`, { method: 'PUT', body }),
  add: (body: { name: string; th: string }) => api(`${BASE}/miners`, { method: 'POST', body }),
  update: (id: string, body: { name?: string; th?: string; active?: boolean }) => api(`${BASE}/miners/${encodeURIComponent(id)}`, { method: 'PATCH', body }),
  remove: (id: string) => api(`${BASE}/miners/${encodeURIComponent(id)}`, { method: 'DELETE' }),
}
