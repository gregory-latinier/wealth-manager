import { dec } from '../../lib/money'
import type { CollectResult, HoldingFailure, HoldingLine, SourceType } from '../types'
import { activeAccounts, type BankAccount } from './accounts'

export const BANK_SOURCE_ID = 'bank'

export interface BankDeps {
  accounts?: () => Promise<BankAccount[]>
}

/** Stable key of one account. The currency never changes, so carry-forward always matches. */
export const accountRef = (account: Pick<BankAccount, 'id' | 'currency'>) => `${account.id}:${account.currency}`

export function createBankSource(deps: BankDeps = {}): SourceType {
  const accounts = deps.accounts ?? activeAccounts

  return {
    id: BANK_SOURCE_ID,

    async collect(ctx): Promise<CollectResult> {
      const lines: HoldingLine[] = []
      const failures: HoldingFailure[] = []

      for (const account of await accounts()) {
        const sourceRef = accountRef(account)
        if (account.currency === 'USD') {
          lines.push({ sourceRef, symbol: 'USD', amount: dec(account.balance), priceUsd: dec(1) })
        } else if (ctx.usdPerEur) {
          // The same rate the engine uses for the EUR totals, so a EUR account shows exactly the balance that was typed.
          lines.push({ sourceRef, symbol: 'EUR', amount: dec(account.balance), priceUsd: ctx.usdPerEur })
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

export const createDefaultBankSource = (): SourceType => createBankSource()
