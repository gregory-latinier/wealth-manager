import { dec } from '../../lib/money'
import { createLimiter } from '../crypto/providers/http'
import { reasonOf } from '../smardex/ownership'
import type { CollectResult, HoldingFailure, HoldingLine, SourceType } from '../types'
import { activeHoldings, type StockHolding } from './holdings'
import { createYahooQuotes, type QuoteProvider } from './yahoo'

export const STOCKS_SOURCE_ID = 'stocks'

export interface StocksDeps {
  quotes: QuoteProvider
  holdings?: () => Promise<StockHolding[]>
}

/** Stable key of one holding. The ticker never changes, so carry-forward always matches. */
export const holdingRef = (holding: Pick<StockHolding, 'id' | 'symbol'>) => `${holding.id}:${holding.symbol}`

export function createStocksSource(deps: StocksDeps): SourceType {
  const holdings = deps.holdings ?? activeHoldings
  const limit = createLimiter(3)

  return {
    id: STOCKS_SOURCE_ID,

    async collect(ctx): Promise<CollectResult> {
      const lines: HoldingLine[] = []
      const failures: HoldingFailure[] = []

      await Promise.all(
        (await holdings()).map((holding) =>
          limit(async () => {
            const sourceRef = holdingRef(holding)
            try {
              const quote = await deps.quotes.getQuote(holding.symbol)
              // The listing was checked when it was added. If it is quoted in another currency now, valuing it would be wrong.
              if (quote.currency !== holding.currency) {
                failures.push({ sourceRef, reason: `${holding.symbol} is now quoted in ${quote.currency}, it was added in ${holding.currency}` })
              } else if (holding.currency === 'USD') {
                lines.push({ sourceRef, symbol: holding.symbol, amount: dec(holding.quantity), priceUsd: quote.price })
              } else if (ctx.usdPerEur) {
                // The same rate the engine uses for the EUR totals, so a EUR listing is worth exactly quantity times its EUR price in EUR.
                lines.push({ sourceRef, symbol: holding.symbol, amount: dec(holding.quantity), priceUsd: quote.price.mul(ctx.usdPerEur) })
              } else {
                // No rate is a failure (carried forward as stale), never a line valued at 0.
                failures.push({ sourceRef, reason: 'the EUR/USD rate is unavailable' })
              }
            } catch (err) {
              failures.push({ sourceRef, reason: `could not read the price of ${holding.symbol}: ${reasonOf(err)}` })
            }
          })
        )
      )

      lines.sort((a, b) => a.sourceRef.localeCompare(b.sourceRef))
      failures.sort((a, b) => a.sourceRef.localeCompare(b.sourceRef))
      return { lines, failures }
    },
  }
}

/** The stocks source wired to Yahoo Finance quotes. */
export const createDefaultStocksSource = (): SourceType => createStocksSource({ quotes: createYahooQuotes() })
