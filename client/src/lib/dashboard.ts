import { api } from './api'

export type Currency = 'USD' | 'EUR'

export interface SnapshotSummary {
  date: string
  status: 'complete' | 'partial'
  usdPerEur: string
  rateStale: boolean
  totalUsd: string
  totalEur: string
}

export interface ChangeFigure {
  abs: string
  /** null when the earlier total was 0. */
  pct: string | null
}

export interface Change {
  since: string
  usd: ChangeFigure
  eur: ChangeFigure
}

export interface BreakdownLine {
  sourceType: string
  sourceRef: string
  symbol: string
  amount: string
  priceUsd: string
  valueUsd: string
  valueEur: string
  stale: boolean
  staleSince: string | null
}

export interface DashboardData {
  latest: SnapshotSummary | null
  change: { day: Change | null; week: Change | null }
  series: { date: string; totalUsd: string; totalEur: string; status: 'complete' | 'partial' }[]
  breakdown: { date: string; status: 'complete' | 'partial'; lines: BreakdownLine[] } | null
}

// Source types the app knows by name. A later one (stocks, bank, aave) adds a line here, and until it does it is shown capitalised.
const SOURCE_LABEL: Record<string, string> = { crypto: 'Crypto', exchange: 'Exchanges', stocks: 'Stocks', bank: 'Bank', crowdlending: 'Crowdlending', mt5: 'MT5', gomining: 'GoMining',aave: 'Aave', smardex: 'Smardex', staking: 'Staking', forex: 'Forex' }

export const sourceLabel = (sourceType: string): string => SOURCE_LABEL[sourceType] ?? sourceType.charAt(0).toUpperCase() + sourceType.slice(1)

/** How holdings are grouped, in both the donut and the table. */
export type Grouping = 'asset' | 'category' | 'type' | 'status'

/** Whether a holding can be used now. Worked out from where it sits, since no source stores an unlock date yet. */
export type Status = 'available' | 'locked' | 'borrowed'

/**
 * - borrowed: a debt (an Aave `:debt` line, or any line with a negative value).
 * - locked: staked principal, Smardex positions, GoMining miners, supply deposited on Aave (it backs the loan), crowdlending loans.
 * - available: everything else, including claimable staking rewards and the GoMining wallet balance.
 * A source type this does not know is treated as available, so a new source never disappears or looks frozen by mistake.
 */
export function statusOf(l: BreakdownLine): Status {
  if (l.sourceType === 'aave') return l.sourceRef.endsWith(':debt') || Number(l.valueUsd) < 0 ? 'borrowed' : 'locked'
  if (Number(l.valueUsd) < 0) return 'borrowed'
  switch (l.sourceType) {
    case 'staking':
      return l.sourceRef.endsWith(':rewards') ? 'available' : 'locked'
    case 'gomining':
      return l.sourceRef.startsWith('wallet:') ? 'available' : 'locked'
    case 'smardex':
    case 'crowdlending':
      return 'locked'
    default:
      return 'available'
  }
}

const STATUS_LABEL: Record<Status, string> = { available: 'Available', locked: 'Locked', borrowed: 'Borrowed' }
const STATUS_COLOR: Record<Status, string> = { available: '#4cd9a0', locked: '#f0b429', borrowed: '#ff6b6b' }
export const statusLabel = (status: string): string => STATUS_LABEL[status as Status] ?? status
export const statusColor = (status: string): string | undefined => STATUS_COLOR[status as Status]

// Broad categories that source types roll up into. Everything on-chain or on an exchange is crypto, including the DeFi positions,
// because they are held in crypto and move with it. A source type missing here is shown as its own category rather than hidden in "Other".
const CATEGORY_OF: Record<string, string> = {
  crypto: 'crypto',
  exchange: 'crypto',
  staking: 'crypto',
  aave: 'crypto',
  smardex: 'crypto',
  gomining: 'crypto',
  stocks: 'stocks',
  bank: 'cash',
  mt5: 'cash',
  forex: 'cash',
  crowdlending: 'crowdlending',
}
const CATEGORY_LABEL: Record<string, string> = { crypto: 'Crypto', stocks: 'Stocks & ETFs', cash: 'Cash & trading accounts', crowdlending: 'Crowdlending' }

// One color per category, shared by the donut and the cards so a category looks the same everywhere. Same family as the donut's ramp.
const CATEGORY_COLOR: Record<string, string> = { crypto: '#a78bfa', stocks: '#4cd9a0', cash: '#5eb5ff', crowdlending: '#f0b429' }
export const categoryColor = (category: string): string | undefined => CATEGORY_COLOR[category]

export const categoryOf = (sourceType: string): string => CATEGORY_OF[sourceType] ?? sourceType
export const categoryLabel = (category: string): string => CATEGORY_LABEL[category] ?? sourceLabel(category)

/** Group a holding belongs to: its symbol, its category, the source type it comes from, or whether it can be used now. */
export function groupKey(l: BreakdownLine, grouping: Grouping): string {
  switch (grouping) {
    case 'asset':
      return l.symbol
    case 'category':
      return categoryOf(l.sourceType)
    case 'status':
      return statusOf(l)
    default:
      return l.sourceType
  }
}
export function groupLabel(l: BreakdownLine, grouping: Grouping): string {
  switch (grouping) {
    case 'asset':
      return l.symbol
    case 'category':
      return categoryLabel(categoryOf(l.sourceType))
    case 'status':
      return statusLabel(statusOf(l))
    default:
      return sourceLabel(l.sourceType)
  }
}

/** Color a group keeps in the donut, when its grouping has fixed colors. Other groupings follow the donut's ramp. */
export const groupColor = (grouping: Grouping, key: string): string | undefined =>
  grouping === 'category' ? categoryColor(key) : grouping === 'status' ? statusColor(key) : undefined

export const fetchDashboard = (date?: string) => api<DashboardData>(date ? `/api/dashboard?date=${encodeURIComponent(date)}` : '/api/dashboard')

/** Display only. Totals stay decimal strings everywhere else. */
export function compactMoney(value: number, currency: Currency): string {
  return new Intl.NumberFormat('en', { style: 'currency', currency, notation: 'compact', maximumFractionDigits: 1 }).format(value)
}
