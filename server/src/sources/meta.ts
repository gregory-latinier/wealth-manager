/**
 * What the dashboard needs to know about a source type beyond its lines: a name, the category it rolls up into, and whether a
 * given line can be used now. This is the one place to edit when a source is added. A test fails if a registered source has no entry.
 *
 * It is a static table, not read from the registry, because old snapshots keep lines of source types that are no longer registered
 * (forex, for one) and those must still be named and grouped.
 */

/**
 * Whether a holding can be used now. `at_loss` is available, but worth less than its entered cost: selling it would realise a loss.
 * No source stores an unlock date, so this is worked out from the source and the line reference. */
export type Status = 'available' | 'at_loss' | 'locked' | 'borrowed'

export interface SourceMeta {
  label: string
  /** Key of the category the source belongs to. A key missing from CATEGORY_LABEL is shown capitalised. */
  category: string
  /** Status of a line of this source, from its reference. Absent means available. A negative value is always borrowed. */
  status?: (sourceRef: string) => Status
}

export const CATEGORY_LABEL: Record<string, string> = {
  crypto: 'Crypto',
  stocks: 'Stocks & ETFs',
  cash: 'Cash & trading accounts',
  crowdlending: 'Crowdlending',
}

export const SOURCE_META: Record<string, SourceMeta> = {
  // Everything on-chain or on an exchange is crypto, DeFi positions included: they are held in crypto and move with it.
  crypto: { label: 'Crypto', category: 'crypto' },
  exchange: { label: 'Exchanges', category: 'crypto' },
  smardex: { label: 'Smardex', category: 'crypto', status: () => 'locked' },
  // Staked principal is locked. Claimable rewards are not.
  staking: { label: 'Staking', category: 'crypto', status: (ref) => (ref.endsWith(':rewards') ? 'available' : 'locked') },
  // Supply backs the loan, so it is locked. A debt line is borrowed.
  aave: { label: 'Aave', category: 'crypto', status: (ref) => (ref.endsWith(':debt') ? 'borrowed' : 'locked') },
  // Miners are locked. The BTC and GMT balance of the wallet is not.
  gomining: { label: 'GoMining', category: 'crypto', status: (ref) => (ref.startsWith('wallet:') ? 'available' : 'locked') },
  stocks: { label: 'Stocks', category: 'stocks' },
  bank: { label: 'Bank', category: 'cash' },
  mt5: { label: 'MT5', category: 'cash' },
  // No longer a registered source, kept so older snapshots are still named.
  forex: { label: 'Forex', category: 'cash' },
  crowdlending: { label: 'Crowdlending', category: 'crowdlending', status: () => 'locked' },
}

const capitalise = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

export interface LineMeta {
  sourceLabel: string
  category: string
  categoryLabel: string
  status: Status
}

/** A source type with no entry is its own category and counts as available, so a new source never vanishes or looks frozen by mistake. */
export function lineMeta(sourceType: string, sourceRef: string, valueUsd: string): LineMeta {
  const meta = SOURCE_META[sourceType]
  const category = meta?.category ?? sourceType
  const fromSource = meta?.status?.(sourceRef) ?? 'available'
  return {
    sourceLabel: meta?.label ?? capitalise(sourceType),
    category,
    categoryLabel: CATEGORY_LABEL[category] ?? meta?.label ?? capitalise(category),
    // A negative value is a debt whatever the source says.
    status: Number(valueUsd) < 0 ? 'borrowed' : fromSource,
  }
}

/** An available holding worth less than what was paid for it becomes `at_loss`. Locked and borrowed holdings keep their status. */
export function withCost(status: Status, pnlUsd: string | null): Status {
  return status === 'available' && pnlUsd !== null && Number(pnlUsd) < 0 ? 'at_loss' : status
}
