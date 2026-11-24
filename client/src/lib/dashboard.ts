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

/** Whether a holding can be used now. Decided on the server, which knows the sources. */
export type Status = 'available' | 'at_loss' | 'locked' | 'borrowed'

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
  /** Name of the source type (Exchanges, Staking...). */
  sourceLabel: string
  /** Key of the category the source rolls up into (crypto, stocks, cash, crowdlending). */
  category: string
  categoryLabel: string
  status: Status
  /** What the owner paid for the position, in USD. Null when not entered: an unknown cost is not a zero gain. */
  costUsd: string | null
  /** Value minus cost, in USD, and as a percent of the cost (null when there is no cost, or it is 0). */
  pnlUsd: string | null
  pnlPct: string | null
}

export interface DashboardData {
  latest: SnapshotSummary | null
  change: { day: Change | null; week: Change | null }
  series: { date: string; totalUsd: string; totalEur: string; status: 'complete' | 'partial' }[]
  breakdown: { date: string; status: 'complete' | 'partial'; lines: BreakdownLine[] } | null
}

/** How holdings are grouped, in both the donut and the table. */
export type Grouping = 'asset' | 'category' | 'type' | 'status'

// Names, categories and statuses come from the server with each line. Only how they look is decided here.
const STATUS_LABEL: Record<Status, string> = { available: 'Available', at_loss: 'Available at a loss', locked: 'Locked', borrowed: 'Borrowed' }
const STATUS_COLOR: Record<Status, string> = { available: '#4cd9a0', at_loss: '#ff9f43', locked: '#f0b429', borrowed: '#ff6b6b' }
export const statusLabel = (status: Status): string => STATUS_LABEL[status]
export const statusColor = (status: string): string | undefined => STATUS_COLOR[status as Status]

// One color per category, shared by the donut and the cards so a category looks the same everywhere. A category with no color here
// (a source added on the server and not styled yet) falls back to the donut's ramp.
const CATEGORY_COLOR: Record<string, string> = { crypto: '#a78bfa', stocks: '#4cd9a0', cash: '#5eb5ff', crowdlending: '#f0b429' }
export const categoryColor = (category: string): string | undefined => CATEGORY_COLOR[category]

/** Group a holding belongs to: its symbol, its category, the source type it comes from, or whether it can be used now. */
export function groupKey(l: BreakdownLine, grouping: Grouping): string {
  switch (grouping) {
    case 'asset':
      return l.symbol
    case 'category':
      return l.category
    case 'status':
      return l.status
    default:
      return l.sourceType
  }
}
export function groupLabel(l: BreakdownLine, grouping: Grouping): string {
  switch (grouping) {
    case 'asset':
      return l.symbol
    case 'category':
      return l.categoryLabel
    case 'status':
      return statusLabel(l.status)
    default:
      return l.sourceLabel
  }
}

/** Color a group keeps in the donut, when its grouping has fixed colors. Other groupings follow the donut's ramp. */
export const groupColor = (grouping: Grouping, key: string): string | undefined =>
  grouping === 'category' ? categoryColor(key) : grouping === 'status' ? statusColor(key) : undefined

export interface PnlTotal {
  pnlUsd: number
  /** Percent of the cost of the lines counted. Null when that cost is 0. */
  pnlPct: number | null
  /** Lines that have a cost, out of all the lines. The total only covers the first. */
  counted: number
  total: number
}

/**
 * Unrealised gain of a set of lines. Only lines with an entered cost are counted: a line without one has no known gain, and counting
 * it as zero would hide that. Null when no line has a cost. Display only, the exact figures stay decimal strings per line.
 */
export function pnlTotal(lines: BreakdownLine[]): PnlTotal | null {
  let pnl = 0
  let cost = 0
  let counted = 0
  for (const l of lines) {
    if (l.pnlUsd === null || l.costUsd === null) continue
    pnl += Number(l.pnlUsd)
    cost += Number(l.costUsd)
    counted += 1
  }
  return counted === 0 ? null : { pnlUsd: pnl, pnlPct: cost === 0 ? null : (pnl / cost) * 100, counted, total: lines.length }
}

const COST_URL ='/api/admin/cost-basis'
export const costApi = {
  set: (sourceType: string, sourceRef: string, costUsd: string) => api(COST_URL, { method: 'PUT', body: { sourceType, sourceRef, costUsd } }),
  clear: (sourceType: string, sourceRef: string) =>
    api(`${COST_URL}?sourceType=${encodeURIComponent(sourceType)}&sourceRef=${encodeURIComponent(sourceRef)}`, { method: 'DELETE' }),
}

export const fetchDashboard = (date?: string) => api<DashboardData>(date ? `/api/dashboard?date=${encodeURIComponent(date)}` : '/api/dashboard')

/** Display only. Totals stay decimal strings everywhere else. */
export function compactMoney(value: number, currency: Currency): string {
  return new Intl.NumberFormat('en', { style: 'currency', currency, notation: 'compact', maximumFractionDigits: 1 }).format(value)
}
