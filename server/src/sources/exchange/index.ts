import { query } from '../../db/index'
import type { CollectResult, HoldingFailure, HoldingLine, SourceType } from '../types'
import { loadActiveAccounts } from './accounts'
import { createKraken } from './kraken'
import type { ExchangeAdapter, ExchangeId } from './types'

export const EXCHANGE_SOURCE_ID = 'exchange'

export type ExchangeAdapters = Partial<Record<ExchangeId, ExchangeAdapter>>

/** Stable key of one balance inside the exchange source. Carry-forward matches on it. */
export const balanceRef = (exchange: ExchangeId, accountId: string, symbol: string) => `${exchange}:${accountId}:${symbol}`

const reasonOf = (err: unknown) => (err instanceof Error ? err.message : String(err)).slice(0, 300)

/**
 * Refs this account had in its latest snapshot. When the account cannot be read today the engine can only carry
 * forward the refs it is told about, so a failed account reports these instead of silently dropping out of the total.
 */
async function lastKnownRefs(exchange: ExchangeId, accountId: string): Promise<string[]> {
  const prefix = `${exchange}:${accountId}:`
  const res = await query<{ sourceRef: string }>(
    `SELECT l."sourceRef" FROM "SnapshotLine" l
      WHERE l."sourceType" = $1 AND starts_with(l."sourceRef", $2)
        AND l."snapshotId" = (
          SELECT s."id" FROM "Snapshot" s JOIN "SnapshotLine" x ON x."snapshotId" = s."id"
           WHERE x."sourceType" = $1 AND starts_with(x."sourceRef", $2) ORDER BY s."date" DESC LIMIT 1)`,
    [EXCHANGE_SOURCE_ID, prefix]
  )
  return res.rows.map((r) => r.sourceRef)
}

export function createExchangeSource(adapters: ExchangeAdapters): SourceType {
  return {
    id: EXCHANGE_SOURCE_ID,

    async collect(): Promise<CollectResult> {
      const accounts = await loadActiveAccounts()
      const lines: HoldingLine[] = []
      const failures: HoldingFailure[] = []

      await Promise.all(
        accounts.map(async ({ account, credentials }) => {
          const failWhole = async (reason: string) => {
            const refs = await lastKnownRefs(account.exchange, account.id)
            // Nothing known yet (a new account that failed on its first run): one marker, so the run shows as partial.
            for (const sourceRef of refs.length > 0 ? refs : [balanceRef(account.exchange, account.id, '*')]) {
              failures.push({ sourceRef, reason })
            }
          }

          const adapter = adapters[account.exchange]
          if (!adapter) return failWhole(`${account.exchange} is not supported`)
          try {
            for (const b of await adapter.getBalances(credentials())) {
              const sourceRef = balanceRef(account.exchange, account.id, b.ref)
              // An asset the exchange cannot price is a failure (carried forward), never a line valued at 0.
              if (!b.priceUsd) failures.push({ sourceRef, reason: `no USD price for ${b.symbol}` })
              else lines.push({ sourceRef, symbol: b.symbol, amount: b.amount, priceUsd: b.priceUsd })
            }
          } catch (err) {
            await failWhole(reasonOf(err))
          }
        })
      )

      // Promise.all finishes in network order; sort so the result does not depend on timing.
      lines.sort((a, b) => a.sourceRef.localeCompare(b.sourceRef))
      failures.sort((a, b) => a.sourceRef.localeCompare(b.sourceRef))
      return { lines, failures }
    },
  }
}

export function createDefaultAdapters(): ExchangeAdapters {
  return { kraken: createKraken() }
}

/** The exchange source wired to the real exchanges. */
export function createDefaultExchangeSource(): SourceType {
  return createExchangeSource(createDefaultAdapters())
}
