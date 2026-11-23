import { dec } from '../../lib/money'
import type { CollectResult, HoldingFailure, HoldingLine, SourceType } from '../types'
import { activeLoans, type Loan } from './loans'

export const CROWDLENDING_SOURCE_ID = 'crowdlending'

export interface CrowdlendingDeps {
  loans?: () => Promise<Loan[]>
}

/** Stable key of one loan. Loans are always in EUR, so the ref never changes. */
export const loanRef = (loan: Pick<Loan, 'id'>) => `${loan.id}:EUR`

export function createCrowdlendingSource(deps: CrowdlendingDeps = {}): SourceType {
  const loans = deps.loans ?? activeLoans

  return {
    id: CROWDLENDING_SOURCE_ID,

    async collect(ctx): Promise<CollectResult> {
      const lines: HoldingLine[] = []
      const failures: HoldingFailure[] = []

      for (const loan of await loans()) {
        const sourceRef = loanRef(loan)
        if (ctx.usdPerEur) {
          // The same rate the engine uses for the EUR totals, so a loan shows exactly the outstanding amount that was typed.
          // A repaid loan (outstanding 0) stays as a zero line, so the history shows when it was refunded.
          lines.push({ sourceRef, symbol: 'EUR', amount: dec(loan.outstanding), priceUsd: ctx.usdPerEur })
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

export const createDefaultCrowdlendingSource = (): SourceType => createCrowdlendingSource()
