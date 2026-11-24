import { query } from '../db/index'
import { dec, fixed, VALUE_DP } from '../lib/money'

export const COST_CURRENCIES = ['USD', 'EUR'] as const
export type CostCurrency = (typeof COST_CURRENCIES)[number]

/** What was paid for a position (the total, not per unit), in the currency it was paid in. Keyed like a snapshot line. */
export interface CostBasis {
  sourceType: string
  sourceRef: string
  cost: string
  currency: CostCurrency
}

/** A cost whose position is not in the latest snapshot any more. `symbol` is the last one seen for it, null if it never appeared. */
export interface OrphanCost extends CostBasis {
  symbol: string | null
}

export const COST_KEY = (sourceType: string, sourceRef: string) => `${sourceType}\u0000${sourceRef}`

const COLUMNS = `"sourceType", "sourceRef", "cost"::text AS "cost", "currency"`

export async function listCostBasis(): Promise<CostBasis[]> {
  return (await query<CostBasis>(`SELECT ${COLUMNS} FROM "CostBasis" ORDER BY "sourceType", "sourceRef"`)).rows
}

export async function costBasisMap(): Promise<Map<string, CostBasis>> {
  return new Map((await listCostBasis()).map((c) => [COST_KEY(c.sourceType, c.sourceRef), c]))
}

export async function setCostBasis(sourceType: string, sourceRef: string, cost: string, currency: CostCurrency): Promise<CostBasis> {
  const res = await query<CostBasis>(
    `INSERT INTO "CostBasis" ("sourceType", "sourceRef", "cost", "currency") VALUES ($1, $2, $3, $4)
     ON CONFLICT ("sourceType", "sourceRef") DO UPDATE SET "cost" = EXCLUDED."cost", "currency" = EXCLUDED."currency", "updatedAt" = NOW()
     RETURNING ${COLUMNS}`,
    [sourceType, sourceRef, cost, currency]
  )
  return res.rows[0]
}

export async function deleteCostBasis(sourceType: string, sourceRef: string): Promise<boolean> {
  const res = await query(`DELETE FROM "CostBasis" WHERE "sourceType" = $1 AND "sourceRef" = $2`, [sourceType, sourceRef])
  return (res.rowCount ?? 0) > 0
}

/**
 * Costs with no line in the snapshot of `latestDate`. A position that was sold, removed or renamed leaves its cost behind, and
 * nothing else would ever show it. Not tied to the date being viewed, so looking at an old day does not flag every recent position.
 */
export async function orphanCosts(latestDate: string): Promise<OrphanCost[]> {
  return (
    await query<OrphanCost>(
      `SELECT c."sourceType", c."sourceRef", c."cost"::text AS "cost", c."currency",
              (SELECT l."symbol" FROM "SnapshotLine" l JOIN "Snapshot" s ON s."id" = l."snapshotId"
                WHERE l."sourceType" = c."sourceType" AND l."sourceRef" = c."sourceRef" ORDER BY s."date" DESC LIMIT 1) AS "symbol"
         FROM "CostBasis" c
        WHERE NOT EXISTS (SELECT 1 FROM "SnapshotLine" l JOIN "Snapshot" s ON s."id" = l."snapshotId"
                           WHERE s."date" = $1 AND l."sourceType" = c."sourceType" AND l."sourceRef" = c."sourceRef")
        ORDER BY c."sourceType", c."sourceRef"`,
      [latestDate]
    )
  ).rows
}

export interface Pnl {
  /** The cost as typed, with its currency, so the dialog can show it back. */
  cost: string | null
  costCurrency: CostCurrency | null
  /** The cost in each currency. The one it was typed in is exact, the other uses the rate of the snapshot shown. */
  costUsd: string | null
  costEur: string | null
  /** Value minus cost. Null when no cost is known: an unknown cost is never shown as a zero gain. */
  pnlUsd: string | null
  pnlEur: string | null
  /** Percent of the cost. The same in both currencies. Null when there is no cost or it is 0 (an airdrop has no percentage). */
  pnlPct: string | null
}

const NO_COST: Pnl = { cost: null, costCurrency: null, costUsd: null, costEur: null, pnlUsd: null, pnlEur: null, pnlPct: null }

/** `usdPerEur` is the rate of the snapshot the values come from, so the two currencies of one line agree with each other. */
export function pnlOf(valueUsd: string, valueEur: string, entered: Pick<CostBasis, 'cost' | 'currency'> | undefined, usdPerEur: string): Pnl {
  if (!entered) return NO_COST
  const cost = dec(entered.cost)
  const rate = dec(usdPerEur)
  const costUsd = entered.currency === 'USD' ? cost : cost.mul(rate)
  const costEur = entered.currency === 'EUR' ? cost : cost.div(rate)
  const pnlUsd = dec(valueUsd).minus(costUsd)
  const pnlEur = dec(valueEur).minus(costEur)
  return {
    cost: fixed(cost, VALUE_DP),
    costCurrency: entered.currency,
    costUsd: fixed(costUsd, VALUE_DP),
    costEur: fixed(costEur, VALUE_DP),
    pnlUsd: fixed(pnlUsd, VALUE_DP),
    pnlEur: fixed(pnlEur, VALUE_DP),
    pnlPct: costUsd.isZero() ? null : fixed(pnlUsd.div(costUsd).mul(100), 2),
  }
}
