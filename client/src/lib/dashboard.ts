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
const SOURCE_LABEL: Record<string, string> = { crypto: 'Crypto', exchange: 'Exchanges', stocks: 'Stocks', bank: 'Bank', crowdlending: 'Crowdlending', mt5: 'MT5', aave: 'Aave', smardex: 'Smardex', staking: 'Staking', forex: 'Forex' }

export const sourceLabel = (sourceType: string): string => SOURCE_LABEL[sourceType] ?? sourceType.charAt(0).toUpperCase() + sourceType.slice(1)

/** How holdings are grouped, in both the donut and the table. */
export type Grouping = 'asset' | 'type'

/** Group a holding belongs to: its symbol, or the source type it comes from. */
export const groupKey = (l: BreakdownLine, grouping: Grouping): string => (grouping === 'asset' ? l.symbol : l.sourceType)
export const groupLabel = (l: BreakdownLine, grouping: Grouping): string => (grouping === 'asset' ? l.symbol : sourceLabel(l.sourceType))

export const fetchDashboard = (date?: string) => api<DashboardData>(date ? `/api/dashboard?date=${encodeURIComponent(date)}` : '/api/dashboard')

/** Display only. Totals stay decimal strings everywhere else. */
export function compactMoney(value: number, currency: Currency): string {
  return new Intl.NumberFormat('en', { style: 'currency', currency, notation: 'compact', maximumFractionDigits: 1 }).format(value)
}
