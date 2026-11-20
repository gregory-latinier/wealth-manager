import { query } from '../../db/index'
import { Decimal, VALUE_DP, AMOUNT_DP, fixed } from '../../lib/money'
import type { CryptoAddress } from './addresses'
import type { ScanProvider, ScanToken } from './providers/blockscout'
import { getThresholdUsd, listIgnored } from './settings'
import { isEvmChain } from './validate'

export interface ScanEntry {
  contract: string
  symbol: string
  name: string
  decimals: number
  /** Decimal strings, never floats. */
  balance: string
  priceUsd: string | null
  valueUsd: string | null
  /** Already tracked on this address. */
  tracked: boolean
}

export interface HiddenEntry extends ScanEntry {
  hiddenReason: 'ignored' | 'spam'
}

export type ScanResult =
  | { status: 'disabled'; reason: string }
  | {
      status: 'ok'
      thresholdUsd: string
      /** Priced and at or above the threshold. Preselected in the UI. */
      selectable: ScanEntry[]
      /** No price known. Listed separately and never preselected. */
      unpriced: ScanEntry[]
      /** Spam-flagged or ignored. Only shown behind a toggle. */
      hidden: HiddenEntry[]
      /** Priced but under the threshold. Counted, not listed. */
      belowThresholdCount: number
      /** The price source failed, so "unpriced" below means "could not look up", not "no price exists". */
      pricesUnavailable: boolean
    }

function toEntry(token: ScanToken, tracked: boolean): ScanEntry {
  const value = token.priceUsd ? token.balance.mul(token.priceUsd) : null
  return {
    contract: token.contract,
    symbol: token.symbol,
    name: token.name,
    decimals: token.decimals,
    balance: fixed(token.balance, AMOUNT_DP),
    priceUsd: token.priceUsd ? token.priceUsd.toString() : null,
    valueUsd: value ? fixed(value, VALUE_DP) : null,
    tracked,
  }
}

const byValueDesc = (a: ScanEntry, b: ScanEntry) =>
  new Decimal(b.valueUsd ?? 0).comparedTo(new Decimal(a.valueUsd ?? 0)) || a.symbol.localeCompare(b.symbol)

/** Scans one address. BTC has no tokens, so it gets an empty result rather than an error. */
export async function scanAddress(address: CryptoAddress, provider: ScanProvider): Promise<ScanResult> {
  const thresholdUsd = await getThresholdUsd()
  const empty: ScanResult = { status: 'ok', thresholdUsd, selectable: [], unpriced: [], hidden: [], belowThresholdCount: 0, pricesUnavailable: false }
  if (!isEvmChain(address.chain)) return empty

  const support = provider.support(address.chain)
  if (!support.enabled) return { status: 'disabled', reason: support.reason }

  const [tokens, ignoredRows, trackedRows] = await Promise.all([
    provider.listTokens(address.chain, address.address),
    listIgnored(),
    query<{ contractAddress: string }>(
      `SELECT "contractAddress" FROM "CryptoAsset" WHERE "addressId" = $1 AND "kind" = 'token'`,
      [address.id]
    ),
  ])
  const ignored = new Set(ignoredRows.filter((i) => i.chain === address.chain).map((i) => i.contractAddress))
  const tracked = new Set(trackedRows.rows.map((r) => r.contractAddress))
  const threshold = new Decimal(thresholdUsd)

  const result = { ...empty, selectable: [] as ScanEntry[], unpriced: [] as ScanEntry[], hidden: [] as HiddenEntry[] }
  for (const token of tokens) {
    if (token.balance.isZero()) continue // a zero balance is nothing to track
    const entry = toEntry(token, tracked.has(token.contract))

    if (ignored.has(token.contract)) result.hidden.push({ ...entry, hiddenReason: 'ignored' })
    else if (token.reputation !== null && token.reputation !== 'ok') result.hidden.push({ ...entry, hiddenReason: 'spam' })
    else if (!token.priceUsd) result.unpriced.push(entry)
    else if (token.balance.mul(token.priceUsd).gte(threshold)) result.selectable.push(entry)
    else result.belowThresholdCount++
  }

  result.pricesUnavailable = provider.pricesUnavailable?.(address.chain, address.address) ?? false
  result.selectable.sort(byValueDesc)
  result.hidden.sort(byValueDesc)
  result.unpriced.sort((a, b) => a.symbol.localeCompare(b.symbol))
  return result
}
