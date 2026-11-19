import type { Decimal } from '../lib/money'

/** Identifies a source type in storage (crypto, aave, forex, bank, stocks, ...). */
export type SourceId = string

export interface SnapshotContext {
  /** UTC date of the snapshot being taken (YYYY-MM-DD). */
  date: string
}

/** One successfully valued holding. The engine computes the USD and EUR values from these. */
export interface HoldingLine {
  /** Stable key of the entry inside its source, e.g. `eth:0xabc…:native`. Carry-forward matches on it. */
  sourceRef: string
  symbol: string
  amount: Decimal
  /** USD price of one unit of `amount`. Use 1 for USD cash. */
  priceUsd: Decimal
}

export interface HoldingFailure {
  sourceRef: string
  reason: string
}

export interface CollectResult {
  lines: HoldingLine[]
  /** Entries that could not be valued this time. The engine tries to carry them forward. */
  failures: HoldingFailure[]
}

export interface SourceType {
  id: SourceId
  /**
   * Return every active holding. Report a bad entry in `failures` instead of throwing.
   * If it throws anyway, the engine treats the whole source as failed and carries its last lines forward.
   */
  collect(ctx: SnapshotContext): Promise<CollectResult>
}
