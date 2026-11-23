import { dec, type Decimal } from '../../lib/money'
import { DEFAULT_TIMEOUT_MS, fetchJson, type FetchLike } from '../crypto/providers/http'
import { ProviderError } from '../crypto/providers/types'
import { getFeedUrl } from './settings'

const PROVIDER = 'mt5-feed'
/** An account the collector has not updated for longer than this is not trusted as current (the collector posts every 10 minutes). */
export const MAX_AGE_HOURS = 48

export interface FeedAccount {
  /** The MT5 login. */
  login: string
  name: string
  broker: string
  /** Balance in the account currency, already divided for cent accounts. Null when the row is an error row or carries no usable number. */
  balance: Decimal | null
  /** Why the balance cannot be used, or null when it can. */
  problem: string | null
  /** When the collector last read this account. */
  updatedAt: Date | null
}

/** No feed URL is set yet. Every owner runs their own collector, so there is no default to fall back on. */
export class FeedNotConfiguredError extends Error {
  constructor() {
    super('no feed URL is set, add it on the MT5 page')
    this.name = 'FeedNotConfiguredError'
  }
}

// The feed holds balances only, never an MT5 password.
export interface Mt5Feed {
  accounts(): Promise<FeedAccount[]>
}

const text = (value: unknown): string => (typeof value === 'string' ? value : '')

/** Parses the `allAccounts` list of the feed. A broken row is kept with a `problem`, so it is reported instead of vanishing. Exported for tests. */
export function parseFeed(payload: unknown, now: Date = new Date()): FeedAccount[] {
  const list = (payload as { allAccounts?: unknown } | null)?.allAccounts
  if (!Array.isArray(list)) throw new ProviderError(PROVIDER, 'malformed', 'expected an "allAccounts" array')

  const accounts: FeedAccount[] = []
  for (const row of list as Array<Record<string, unknown>>) {
    const login = typeof row?.account === 'number' ? String(row.account) : text(row?.account).trim()
    if (!login) continue
    const updatedAt = typeof row.updatedAt === 'string' && !Number.isNaN(Date.parse(row.updatedAt)) ? new Date(Date.parse(row.updatedAt)) : null

    let problem: string | null = null
    let balance: Decimal | null = null
    if (row.status !== 'ok') {
      problem = typeof row.status === 'string' && row.status ? row.status : 'the collector reports no status'
    } else if (typeof row.balance !== 'number' || !Number.isFinite(row.balance)) {
      problem = 'no valid balance'
    } else if (!updatedAt) {
      problem = 'no update time'
    } else if (now.getTime() - updatedAt.getTime() > MAX_AGE_HOURS * 3_600_000) {
      problem = `last updated ${updatedAt.toISOString().slice(0, 16).replace('T', ' ')} UTC, too old to be a current balance`
    } else {
      balance = dec(String(row.balance))
    }
    accounts.push({ login, name: text(row.name) || login, broker: text(row.broker), balance, problem, updatedAt })
  }
  return accounts
}

export function createMt5Feed(options: { fetch?: FetchLike; getUrl?: () => Promise<string | null>; timeoutMs?: number; now?: () => Date } = {}): Mt5Feed {
  const doFetch = options.fetch ?? fetch
  const getUrl = options.getUrl ?? getFeedUrl
  const now = options.now ?? (() => new Date())
  return {
    async accounts() {
      const url = await getUrl()
      if (!url) throw new FeedNotConfiguredError()
      const body = await fetchJson(PROVIDER, doFetch, url, { timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS })
      return parseFeed(body, now())
    },
  }
}
