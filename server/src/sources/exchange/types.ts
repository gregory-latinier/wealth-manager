import type { Decimal } from '../../lib/money'

export type ExchangeId = 'kraken' | 'okx'
export const EXCHANGES: readonly ExchangeId[] = ['kraken', 'okx']

export const EXCHANGE_LABEL: Record<ExchangeId, string> = { kraken: 'Kraken', okx: 'OKX' }

/** What each exchange needs from the owner. OKX also needs the passphrase chosen when the key was created. */
export interface Credentials {
  apiKey: string
  apiSecret: string
  passphrase?: string
}

/** One balance as the exchange reports it, already priced in USD. */
export interface ExchangeBalance {
  /** Stable key of the entry inside the account, e.g. `XBT`. Carry-forward matches on it. */
  ref: string
  symbol: string
  amount: Decimal
  /** `null` when the exchange has no USD price for it. The source reports that as a failure, never as 0. */
  priceUsd: Decimal | null
}

export interface ExchangeAdapter {
  id: ExchangeId
  /** Throws a ProviderError when the credentials are rejected or lack the right to read balances. */
  verify(credentials: Credentials): Promise<void>
  /** Every non-zero balance of the account, priced. */
  getBalances(credentials: Credentials): Promise<ExchangeBalance[]>
}
