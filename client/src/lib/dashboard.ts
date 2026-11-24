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
export type Grouping = 'asset' | 'category' | 'type'

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

export const categoryOf = (sourceType: string): string => CATEGORY_OF[sourceType] ?? sourceType
export const categoryLabel = (category: string): string => CATEGORY_LABEL[category] ?? sourceLabel(category)

/** Group a holding belongs to: its symbol, its category, or the source type it comes from. */
export function groupKey(l: BreakdownLine, grouping: Grouping): string {
  if (grouping === 'asset') return l.symbol
  return grouping === 'category' ? categoryOf(l.sourceType) : l.sourceType
}
export function groupLabel(l: BreakdownLine, grouping: Grouping): string {
  if (grouping === 'asset') return l.symbol
  return grouping === 'category' ? categoryLabel(categoryOf(l.sourceType)) : sourceLabel(l.sourceType)
}

export const fetchDashboard = (date?: string) => api<DashboardData>(date ? `/api/dashboard?date=${encodeURIComponent(date)}` : '/api/dashboard')

/** Display only. Totals stay decimal strings everywhere else. */
export function compactMoney(value: number, currency: Currency): string {
  return new Intl.NumberFormat('en', { style: 'currency', currency, notation: 'compact', maximumFractionDigits: 1 }).format(value)
}
