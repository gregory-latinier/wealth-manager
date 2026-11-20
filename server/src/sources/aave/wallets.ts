import { query } from '../../db/index'
import { generateId } from '../../lib/auth'

export interface AaveWallet {
  id: string
  label: string
  /** Lowercase 0x address. */
  address: string
  active: boolean
  createdAt: string
}

export const MAX_LABEL_LENGTH = 100

const COLUMNS = `"id", "label", "address", "active", "createdAt"`

export async function listWallets(): Promise<AaveWallet[]> {
  const res = await query<AaveWallet>(`SELECT ${COLUMNS} FROM "AaveWallet" ORDER BY "createdAt", "id"`)
  return res.rows
}

export async function getWallet(id: string): Promise<AaveWallet | null> {
  const res = await query<AaveWallet>(`SELECT ${COLUMNS} FROM "AaveWallet" WHERE "id" = $1`, [id])
  return res.rows[0] ?? null
}

/** Addresses the snapshot source reads. Paused wallets are skipped. */
export async function activeAddresses(): Promise<string[]> {
  const res = await query<{ address: string }>(`SELECT "address" FROM "AaveWallet" WHERE "active" ORDER BY "createdAt", "id"`)
  return res.rows.map((r) => r.address)
}

/** Returns null when this address is already tracked. */
export async function createWallet(input: { label: string; address: string }): Promise<AaveWallet | null> {
  const res = await query<AaveWallet>(
    `INSERT INTO "AaveWallet" ("id", "label", "address") VALUES ($1, $2, $3)
     ON CONFLICT ("address") DO NOTHING
     RETURNING ${COLUMNS}`,
    [generateId('aw'), input.label, input.address]
  )
  return res.rows[0] ?? null
}

export async function updateWallet(id: string, patch: { label?: string; active?: boolean }): Promise<AaveWallet | null> {
  const sets: string[] = []
  const values: unknown[] = []
  const set = (column: string, value: unknown) => {
    values.push(value)
    sets.push(`"${column}" = $${values.length}`)
  }
  if (patch.label !== undefined) set('label', patch.label)
  if (patch.active !== undefined) set('active', patch.active)
  if (sets.length === 0) return getWallet(id)
  values.push(id)
  const res = await query<AaveWallet>(`UPDATE "AaveWallet" SET ${sets.join(', ')} WHERE "id" = $${values.length} RETURNING ${COLUMNS}`, values)
  return res.rows[0] ?? null
}

/** Removes the wallet. Snapshot history is untouched: lines are denormalized. */
export async function deleteWallet(id: string): Promise<boolean> {
  const res = await query(`DELETE FROM "AaveWallet" WHERE "id" = $1`, [id])
  return (res.rowCount ?? 0) > 0
}

/**
 * Refs the wallet had in the latest snapshot that holds Aave lines. When a wallet cannot be read, these are reported as failures
 * so the previous values, the debt above all, are carried forward instead of dropping out of net worth.
 */
export async function lastRefs(address: string): Promise<string[]> {
  const res = await query<{ sourceRef: string }>(
    `SELECT l."sourceRef" FROM "SnapshotLine" l
      WHERE l."sourceType" = 'aave' AND split_part(l."sourceRef", ':', 1) = $1
        AND l."snapshotId" = (
          SELECT s."id" FROM "Snapshot" s JOIN "SnapshotLine" x ON x."snapshotId" = s."id"
           WHERE x."sourceType" = 'aave' ORDER BY s."date" DESC LIMIT 1)`,
    [address]
  )
  return res.rows.map((r) => r.sourceRef)
}

export interface WalletLastValue {
  usd: string
  eur: string
  date: string
  stale: boolean
}

/** Net value of each wallet in the latest snapshot (supplied minus owed), keyed by address. Lines are `<address>:<reserve id>:supply|debt`. */
export async function lastValues(): Promise<Map<string, WalletLastValue>> {
  const res = await query<{ address: string; usd: string; eur: string; date: string; stale: boolean }>(
    `SELECT split_part(l."sourceRef", ':', 1) AS "address",
            SUM(l."valueUsd")::text AS "usd", SUM(l."valueEur")::text AS "eur", s."date"::text AS "date", BOOL_OR(l."stale") AS "stale"
       FROM "SnapshotLine" l
       JOIN "Snapshot" s ON s."id" = l."snapshotId"
      WHERE l."sourceType" = 'aave' AND s."id" = (SELECT "id" FROM "Snapshot" ORDER BY "date" DESC LIMIT 1)
      GROUP BY 1, s."date"`
  )
  return new Map(res.rows.map((r) => [r.address, { usd: r.usd, eur: r.eur, date: r.date, stale: r.stale }]))
}
