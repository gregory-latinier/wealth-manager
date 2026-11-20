import { query } from '../../db/index'
import { generateId } from '../../lib/auth'

export interface SmardexWallet {
  id: string
  label: string
  /** Lowercase 0x address. */
  address: string
  active: boolean
  createdAt: string
}

export const MAX_LABEL_LENGTH = 100

const COLUMNS = `"id", "label", "address", "active", "createdAt"`

export async function listWallets(): Promise<SmardexWallet[]> {
  const res = await query<SmardexWallet>(`SELECT ${COLUMNS} FROM "SmardexWallet" ORDER BY "createdAt", "id"`)
  return res.rows
}

export async function getWallet(id: string): Promise<SmardexWallet | null> {
  const res = await query<SmardexWallet>(`SELECT ${COLUMNS} FROM "SmardexWallet" WHERE "id" = $1`, [id])
  return res.rows[0] ?? null
}

/** Addresses the snapshot source reads. Paused wallets are skipped. */
export async function activeAddresses(): Promise<string[]> {
  const res = await query<{ address: string }>(`SELECT "address" FROM "SmardexWallet" WHERE "active" ORDER BY "createdAt", "id"`)
  return res.rows.map((r) => r.address)
}

/** Returns null when this address is already tracked. */
export async function createWallet(input: { label: string; address: string }): Promise<SmardexWallet | null> {
  const res = await query<SmardexWallet>(
    `INSERT INTO "SmardexWallet" ("id", "label", "address") VALUES ($1, $2, $3)
     ON CONFLICT ("address") DO NOTHING
     RETURNING ${COLUMNS}`,
    [generateId('sw'), input.label, input.address]
  )
  return res.rows[0] ?? null
}

export async function updateWallet(id: string, patch: { label?: string; active?: boolean }): Promise<SmardexWallet | null> {
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
  const res = await query<SmardexWallet>(`UPDATE "SmardexWallet" SET ${sets.join(', ')} WHERE "id" = $${values.length} RETURNING ${COLUMNS}`, values)
  return res.rows[0] ?? null
}

/** Removes the wallet and the position cache built for it. Snapshot history is untouched: lines are denormalized. */
export async function deleteWallet(id: string): Promise<boolean> {
  const wallet = await getWallet(id)
  if (!wallet) return false
  await query(`DELETE FROM "SmardexPosition" WHERE "address" = $1`, [wallet.address])
  await query(`DELETE FROM "SmardexScan" WHERE "address" = $1`, [wallet.address])
  const res = await query(`DELETE FROM "SmardexWallet" WHERE "id" = $1`, [id])
  return (res.rowCount ?? 0) > 0
}

export interface WalletLastValue {
  usd: string
  eur: string
  date: string
  stale: boolean
}

/** Value of each wallet in the latest snapshot, keyed by address. Lines are `<address>:<tick>:<tickVersion>:<index>`. */
export async function lastValues(): Promise<Map<string, WalletLastValue>> {
  const res = await query<{ address: string; usd: string; eur: string; date: string; stale: boolean }>(
    `SELECT split_part(l."sourceRef", ':', 1) AS "address",
            SUM(l."valueUsd")::text AS "usd", SUM(l."valueEur")::text AS "eur", s."date"::text AS "date", BOOL_OR(l."stale") AS "stale"
       FROM "SnapshotLine" l
       JOIN "Snapshot" s ON s."id" = l."snapshotId"
      WHERE l."sourceType" = 'smardex' AND s."id" = (SELECT "id" FROM "Snapshot" ORDER BY "date" DESC LIMIT 1)
      GROUP BY 1, s."date"`
  )
  return new Map(res.rows.map((r) => [r.address, { usd: r.usd, eur: r.eur, date: r.date, stale: r.stale }]))
}
