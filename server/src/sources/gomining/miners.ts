import { query } from '../../db/index'
import { generateId } from '../../lib/auth'
import { dec } from '../../lib/money'

export interface Miner {
  id: string
  name: string
  /** Computing power in TH/s, fixed-point string with 4 decimals. */
  th: string
  active: boolean
  createdAt: string
}

export const MAX_NAME_LENGTH = 100

const TH = /^\d{1,14}(\.\d{1,4})?$/

/** The TH as stored, or null when it is not a positive plain decimal with at most 4 decimals. */
export function parseTh(input: string): string | null {
  const text = input.trim()
  if (!TH.test(text)) return null
  const value = dec(text)
  return value.gt(0) ? value.toFixed() : null
}

const COLUMNS =`"id", "name", "th"::text AS "th", "active", "createdAt"`

export async function listMiners(): Promise<Miner[]> {
  const res = await query<Miner>(`SELECT ${COLUMNS} FROM "GominingMiner" ORDER BY "createdAt", "id"`)
  return res.rows
}

export async function getMiner(id: string): Promise<Miner | null> {
  const res = await query<Miner>(`SELECT ${COLUMNS} FROM "GominingMiner" WHERE "id" = $1`, [id])
  return res.rows[0] ?? null
}

/** Miners the snapshot source values. Paused ones are skipped. */
export async function activeMiners(): Promise<Miner[]> {
  const res = await query<Miner>(`SELECT ${COLUMNS} FROM "GominingMiner" WHERE "active" ORDER BY "createdAt", "id"`)
  return res.rows
}

export async function createMiner(input: { name: string; th: string }): Promise<Miner> {
  const res = await query<Miner>(`INSERT INTO "GominingMiner" ("id", "name", "th") VALUES ($1, $2, $3) RETURNING ${COLUMNS}`, [generateId('gm'), input.name, input.th])
  return res.rows[0]!
}

export async function updateMiner(id: string, patch: { name?: string; th?: string; active?: boolean }): Promise<Miner | null> {
  const sets: string[] = []
  const values: unknown[] = []
  const set = (column: string, value: unknown) => {
    values.push(value)
    sets.push(`"${column}" = $${values.length}`)
  }
  if (patch.name !== undefined) set('name', patch.name)
  if (patch.th !== undefined) set('th', patch.th)
  if (patch.active !== undefined) set('active', patch.active)
  if (sets.length === 0) return getMiner(id)
  values.push(id)
  const res = await query<Miner>(`UPDATE "GominingMiner" SET ${sets.join(', ')} WHERE "id" = $${values.length} RETURNING ${COLUMNS}`, values)
  return res.rows[0] ?? null
}

/** Removes the miner. Snapshot history is untouched: lines are denormalized. */
export async function deleteMiner(id: string): Promise<boolean> {
  const res = await query(`DELETE FROM "GominingMiner" WHERE "id" = $1`, [id])
  return (res.rowCount ?? 0) > 0
}

export interface LastValue {
  usd: string
  eur: string
  date: string
  stale: boolean
}

/** Value of each GoMining line in the latest snapshot, keyed by source ref (`<miner id>:TH`, `wallet:BTC`, `wallet:GMT`). */
export async function lastValues(): Promise<Map<string, LastValue>> {
  const res = await query<{ ref: string; usd: string; eur: string; date: string; stale: boolean }>(
    `SELECT l."sourceRef" AS "ref", l."valueUsd"::text AS "usd", l."valueEur"::text AS "eur", s."date"::text AS "date", l."stale"
       FROM "SnapshotLine" l
       JOIN "Snapshot" s ON s."id" = l."snapshotId"
      WHERE l."sourceType" = 'gomining' AND s."id" = (SELECT "id" FROM "Snapshot" ORDER BY "date" DESC LIMIT 1)`
  )
  return new Map(res.rows.map((r) => [r.ref, { usd: r.usd, eur: r.eur, date: r.date, stale: r.stale }]))
}
