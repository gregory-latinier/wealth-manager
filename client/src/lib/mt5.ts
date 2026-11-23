import { api } from './api'

export type Mt5Currency = 'EUR' | 'USD'

export interface Mt5LastValue {
  usd: string
  eur: string
  date: string
  stale: boolean
}

export interface Mt5Account {
  login: string
  name: string
  broker: string
  /** Balance in the account currency, from the monitoring feed. Null when the collector cannot give a usable one. */
  balance: string | null
  /** Why the balance cannot be used right now. */
  problem: string | null
  updatedAt: string | null
  /** False for a tracked account the feed no longer lists. */
  inFeed: boolean
  /** Null when the account is not counted in the net worth. */
  tracked: { currency: Mt5Currency; active: boolean; lastValue: Mt5LastValue | null } | null
}

const BASE = '/api/admin/mt5'

export interface Mt5Settings {
  /** Where the monitoring snapshot is read from. Null until the owner sets it. */
  feedUrl: string | null
  /** 'environment' when the server's MT5_FEED_URL supplies it. */
  feedUrlSource: 'setting' | 'environment' | null
}

export const mt5Api = {
  settings: () => api<Mt5Settings>(`${BASE}/settings`),
  /** An empty string forgets the stored URL. */
  setFeedUrl: (feedUrl: string) => api<Mt5Settings>(`${BASE}/settings`, { method: 'PUT', body: { feedUrl } }),
  /** `feedError` is set when the monitoring feed could not be read, and the list is then empty. `feedConfigured` is false when no feed URL is set yet. */
  list: () => api<{ accounts: Mt5Account[]; feedError: string | null; feedConfigured: boolean }>(`${BASE}/accounts`),
  add: (body: { login: string; currency: Mt5Currency }) => api(`${BASE}/accounts`, { method: 'POST', body }),
  update: (login: string, body: { currency?: Mt5Currency; active?: boolean }) => api(`${BASE}/accounts/${encodeURIComponent(login)}`, { method: 'PATCH', body }),
  remove: (login: string) => api(`${BASE}/accounts/${encodeURIComponent(login)}`, { method: 'DELETE' }),
}
