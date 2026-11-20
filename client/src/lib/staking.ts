import { api } from './api'

export interface StakingLastValue {
  usd: string
  eur: string
  date: string
  stale: boolean
}

export interface StakingPosition {
  id: string
  platform: string
  symbol: string
  contract: string
  /** Fixed-point string with 18 decimals, as stored. */
  amount: string
  active: boolean
  createdAt: string
  /** Staking contract and wallet whose claimable rewards are read at each snapshot. Both null when rewards are not tracked. */
  rewardsContract: string | null
  rewardsWallet: string | null
  lastValue: StakingLastValue | null
  /** Claimable rewards in the latest snapshot, apart from the stake. */
  rewardsLastValue: StakingLastValue | null
}

export interface RewardsSettings {
  contract: string
  wallet: string
}

export interface AddedStakingPosition extends StakingPosition {
  /** False when no price is known for the token. Null when the check itself failed. */
  priced: boolean | null
  warning: string | null
}

const BASE = '/api/admin/staking'

export const stakingApi = {
  list: () => api<{ positions: StakingPosition[] }>(`${BASE}/positions`),
  add: (body: { platform: string; contract: string; amount: string; rewards?: RewardsSettings }) =>
    api<AddedStakingPosition>(`${BASE}/positions`, { method: 'POST', body }),
  /** `rewards: null` stops tracking the claimable rewards. */
  update: (id: string, body: { platform?: string; amount?: string; active?: boolean; rewards?: RewardsSettings | null }) =>
    api<StakingPosition>(`${BASE}/positions/${encodeURIComponent(id)}`, { method: 'PATCH', body }),
  remove: (id: string) => api(`${BASE}/positions/${encodeURIComponent(id)}`, { method: 'DELETE' }),
}
