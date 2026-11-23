import { dec } from '../../lib/money'
import { reasonOf } from '../smardex/ownership'
import type { CollectResult, HoldingFailure, HoldingLine, SourceType } from '../types'
import { activeAccounts, type Mt5Account } from './accounts'
import { createMt5Feed, type Mt5Feed } from './feed'

export const MT5_SOURCE_ID = 'mt5'

export interface Mt5Deps {
  accounts?: () => Promise<Mt5Account[]>
  feed?: Mt5Feed
}

/** Stable key of one account. The owner can change the currency, which starts a new line: the old one stays in the history. */
export const accountRef = (account: Pick<Mt5Account, 'login' | 'currency'>) => `${account.login}:${account.currency}`

export function createMt5Source(deps: Mt5Deps = {}): SourceType {
  const accounts = deps.accounts ?? activeAccounts
  const feed = deps.feed ?? createMt5Feed()

  return {
    id: MT5_SOURCE_ID,

    async collect(ctx): Promise<CollectResult> {
      const tracked = await accounts()
      if (tracked.length === 0) return { lines: [], failures: [] }

      const lines: HoldingLine[] = []
      const failures: HoldingFailure[] = []
      const failAll = (reason: string) => tracked.map((a) => ({ sourceRef: accountRef(a), reason }))

      let fromFeed
      try {
        fromFeed = new Map((await feed.accounts()).map((a) => [a.login, a]))
      } catch (err) {
        // The feed is down: every account keeps its last value, marked stale.
        return { lines, failures: failAll(`the monitoring feed is unavailable: ${reasonOf(err)}`).sort((a, b) => a.sourceRef.localeCompare(b.sourceRef)) }
      }

      for (const account of tracked) {
        const sourceRef = accountRef(account)
        const row = fromFeed.get(account.login)
        if (!row) {
          failures.push({ sourceRef, reason: `account ${account.login} is not in the monitoring feed` })
        } else if (!row.balance) {
          failures.push({ sourceRef, reason: row.problem ?? 'no balance' })
        } else if (account.currency === 'USD') {
          lines.push({ sourceRef, symbol: 'USD', amount: row.balance, priceUsd: dec(1) })
        } else if (ctx.usdPerEur) {
          lines.push({ sourceRef, symbol: 'EUR', amount: row.balance, priceUsd: ctx.usdPerEur })
        } else {
          // No rate is a failure (carried forward as stale), never a line valued at 0.
          failures.push({ sourceRef, reason: 'the EUR/USD rate is unavailable' })
        }
      }

      lines.sort((a, b) => a.sourceRef.localeCompare(b.sourceRef))
      failures.sort((a, b) => a.sourceRef.localeCompare(b.sourceRef))
      return { lines, failures }
    },
  }
}

export const createDefaultMt5Source = (): SourceType => createMt5Source()
