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

export const fetchDashboard = (date?: string) => api<DashboardData>(date ? `/api/dashboard?date=${encodeURIComponent(date)}` : '/api/dashboard')

/** Display only. Totals stay decimal strings everywhere else. */
export function compactMoney(value: number, currency: Currency): string {
  return new Intl.NumberFormat('en', { style: 'currency', currency, notation: 'compact', maximumFractionDigits: 1 }).format(value)
}
