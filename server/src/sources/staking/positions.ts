import { query } from '../../db/index'
import { generateId } from '../../lib/auth'

export interface StakingPosition {
  id: string
  platform: string
  symbol: string
  /** Lowercase Ethereum contract of the staked token. */
  contract: string
  /** Fixed-point string, as stored. */
  amount: string
  active: boolean
  createdAt: string
  /** Lowercase staking contract whose claimable rewards are read at each snapshot. Null when rewards are not tracked. */
  rewardsContract: string | null
  /** Lowercase wallet that holds the stake in that contract. Set together with rewardsContract. */
  rewardsWallet: string | null
}

export const MAX_TEXT_LENGTH = 100

const COLUMNS = `"id", "platform", "symbol", "contract", "amount"::text AS "amount", "active", "createdAt", "rewardsContract", "rewardsWallet"`

export async function listPositions(): Promise<StakingPosition[]> {
  const res = await query<StakingPosition>(`SELECT ${COLUMNS} FROM "StakingPosition" ORDER BY "createdAt", "id"`)
  return res.rows
}

export async function getPosition(id: string): Promise<StakingPosition | null> {
  const res = await query<StakingPosition>(`SELECT ${COLUMNS} FROM "StakingPosition" WHERE "id" = $1`, [id])
  return res.rows[0] ?? null
}

/** Positions the snapshot source values. Paused ones are skipped. */
export async function activePositions(): Promise<StakingPosition[]> {
  const res = await query<StakingPosition>(`SELECT ${COLUMNS} FROM "StakingPosition" WHERE "active" ORDER BY "createdAt", "id"`)
  return res.rows
}

/** Returns null when this token is already tracked on that platform. */
export async function createPosition(input: {
  platform: string
  symbol: string
  contract: string
  amount: string
  rewardsContract?: string | null
  rewardsWallet?: string | null
}): Promise<StakingPosition | null> {
  const res = await query<StakingPosition>(
    `INSERT INTO "StakingPosition" ("id", "platform", "symbol", "contract", "amount", "rewardsContract", "rewardsWallet") VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT ("platform", "contract") DO NOTHING
     RETURNING ${COLUMNS}`,
    [generateId('sk'), input.platform, input.symbol, input.contract, input.amount, input.rewardsContract ?? null, input.rewardsWallet ?? null]
  )
  return res.rows[0] ?? null
}

export type UpdateResult = StakingPosition | null | 'duplicate'

/** `rewards: null` stops tracking rewards. Both fields are written together, as the table requires. */
export async function updatePosition(
  id: string,
  patch: { platform?: string; amount?: string; active?: boolean; rewards?: { contract: string; wallet: string } | null }
): Promise<UpdateResult> {
  const sets: string[] = []
  const values: unknown[] = []
  const set = (column: string, value: unknown) => {
    values.push(value)
    sets.push(`"${column}" = $${values.length}`)
  }
  if (patch.platform !== undefined) set('platform', patch.platform)
  if (patch.amount !== undefined) set('amount', patch.amount)
  if (patch.active !== undefined) set('active', patch.active)
  if (patch.rewards !== undefined) {
    set('rewardsContract', patch.rewards?.contract ?? null)
    set('rewardsWallet', patch.rewards?.wallet ?? null)
  }
  if (sets.length === 0) return getPosition(id)
  values.push(id)
  try {
    const res = await query<StakingPosition>(`UPDATE "StakingPosition" SET ${sets.join(', ')} WHERE "id" = $${values.length} RETURNING ${COLUMNS}`, values)
    return res.rows[0] ?? null
  } catch (err) {
    if ((err as { code?: string }).code === '23505') return 'duplicate'
    throw err
  }
}

/** Removes the position. Snapshot history is untouched: lines are denormalized. */
export async function deletePosition(id: string): Promise<boolean> {
  const res = await query(`DELETE FROM "StakingPosition" WHERE "id" = $1`, [id])
  return (res.rowCount ?? 0) > 0
}

export interface PositionLastValue {
  usd: string
  eur: string
  date: string
  stale: boolean
}

/**
 * Value of each position in the latest snapshot, keyed by position id. Lines are `<id>:<SYMBOL>` for the stake and `<id>:rewards` for
 * its claimable rewards, which are reported apart so the stake keeps its own value.
 */
export async function lastValues(): Promise<{ stake: Map<string, PositionLastValue>; rewards: Map<string, PositionLastValue> }> {
  const res = await query<{ id: string; kind: 'stake' | 'rewards'; usd: string; eur: string; date: string; stale: boolean }>(
    `SELECT split_part(l."sourceRef", ':', 1) AS "id",
            CASE WHEN split_part(l."sourceRef", ':', 2) = 'rewards' THEN 'rewards' ELSE 'stake' END AS "kind",
            SUM(l."valueUsd")::text AS "usd", SUM(l."valueEur")::text AS "eur", s."date"::text AS "date", BOOL_OR(l."stale") AS "stale"
       FROM "SnapshotLine" l
       JOIN "Snapshot" s ON s."id" = l."snapshotId"
      WHERE l."sourceType" = 'staking' AND s."id" = (SELECT "id" FROM "Snapshot" ORDER BY "date" DESC LIMIT 1)
      GROUP BY 1, 2, s."date"`
  )
  const result = { stake: new Map<string, PositionLastValue>(), rewards: new Map<string, PositionLastValue>() }
  for (const r of res.rows) result[r.kind].set(r.id, { usd: r.usd, eur: r.eur, date: r.date, stale: r.stale })
  return result
}
