import { query } from '../db/index'
import { dec, fixed, VALUE_DP } from '../lib/money'

/** What was paid for a position (total, in USD), typed in by the owner. Keyed like a snapshot line. */
export interface CostBasis {
  sourceType: string
  sourceRef: string
  costUsd: string
}

export const COST_KEY = (sourceType: string, sourceRef: string) => `${sourceType}\u0000${sourceRef}`

export async function listCostBasis(): Promise<CostBasis[]> {
  return (await query<CostBasis>(`SELECT "sourceType", "sourceRef", "costUsd"::text AS "costUsd" FROM "CostBasis" ORDER BY "sourceType", "sourceRef"`)).rows
}

export async function costBasisMap(): Promise<Map<string, string>> {
  return new Map((await listCostBasis()).map((c) => [COST_KEY(c.sourceType, c.sourceRef), c.costUsd]))
}

export async function setCostBasis(sourceType: string, sourceRef: string, costUsd: string): Promise<CostBasis> {
  const res = await query<CostBasis>(
    `INSERT INTO "CostBasis" ("sourceType", "sourceRef", "costUsd") VALUES ($1, $2, $3)
     ON CONFLICT ("sourceType", "sourceRef") DO UPDATE SET "costUsd" = EXCLUDED."costUsd", "updatedAt" = NOW()
     RETURNING "sourceType", "sourceRef", "costUsd"::text AS "costUsd"`,
    [sourceType, sourceRef, costUsd]
  )
  return res.rows[0]
}

export async function deleteCostBasis(sourceType: string, sourceRef: string): Promise<boolean> {
  const res = await query(`DELETE FROM "CostBasis" WHERE "sourceType" = $1 AND "sourceRef" = $2`, [sourceType, sourceRef])
  return (res.rowCount ?? 0) > 0
}

export interface Pnl {
  costUsd: string | null
  /** Value minus cost, in USD. Null when no cost is known: an unknown cost is never shown as a zero gain. */
  pnlUsd: string | null
  /** Percent of the cost. Null when there is no cost or it is 0 (an airdrop has no percentage). */
  pnlPct: string | null
}

export function pnlOf(valueUsd: string, costUsd: string | undefined): Pnl {
  if (costUsd === undefined) return { costUsd: null, pnlUsd: null, pnlPct: null }
  const cost = dec(costUsd)
  const pnl = dec(valueUsd).minus(cost)
  return { costUsd: fixed(cost, VALUE_DP), pnlUsd: fixed(pnl, VALUE_DP), pnlPct: cost.isZero() ? null : fixed(pnl.div(cost).mul(100), 2) }
}
