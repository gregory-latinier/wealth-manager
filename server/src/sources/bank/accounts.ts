import { query } from '../../db/index'
import { generateId } from '../../lib/auth'

export const CURRENCIES = ['EUR', 'USD'] as const
export type BankCurrency = (typeof CURRENCIES)[number]

export interface BankAccount {
  id: string
  name: string
  /** The institution. Empty when not given. */
  bank: string
  currency: BankCurrency
  /** Fixed-point string with 2 decimals, as stored. Negative for an overdraft. */
  balance: string
  active: boolean
  createdAt: string
}

export const MAX_TEXT_LENGTH = 100

const COLUMNS = `"id", "name", "bank", "currency", "balance"::text AS "balance", "active", "createdAt"`

export async function listAccounts(): Promise<BankAccount[]> {
  const res = await query<BankAccount>(`SELECT ${COLUMNS} FROM "BankAccount" ORDER BY "createdAt", "id"`)
  return res.rows
}

export async function getAccount(id: string): Promise<BankAccount | null> {
  const res = await query<BankAccount>(`SELECT ${COLUMNS} FROM "BankAccount" WHERE "id" = $1`, [id])
  return res.rows[0] ?? null
}

/** Accounts the snapshot source values. Paused ones are skipped. */
export async function activeAccounts(): Promise<BankAccount[]> {
  const res = await query<BankAccount>(`SELECT ${COLUMNS} FROM "BankAccount" WHERE "active" ORDER BY "createdAt", "id"`)
  return res.rows
}

export async function createAccount(input: { name: string; bank: string; currency: BankCurrency; balance: string }): Promise<BankAccount> {
  const res = await query<BankAccount>(
    `INSERT INTO "BankAccount" ("id", "name", "bank", "currency", "balance") VALUES ($1, $2, $3, $4, $5) RETURNING ${COLUMNS}`,
    [generateId('ba'), input.name, input.bank, input.currency, input.balance]
  )
  return res.rows[0]!
}

/** The currency is not editable: it is part of the snapshot key, so changing it would orphan the history. */
export async function updateAccount(id: string, patch: { name?: string; bank?: string; balance?: string; active?: boolean }): Promise<BankAccount | null> {
  const sets: string[] = []
  const values: unknown[] = []
  const set = (column: string, value: unknown) => {
    values.push(value)
    sets.push(`"${column}" = $${values.length}`)
  }
  if (patch.name !== undefined) set('name', patch.name)
  if (patch.bank !== undefined) set('bank', patch.bank)
  if (patch.balance !== undefined) set('balance', patch.balance)
  if (patch.active !== undefined) set('active', patch.active)
  if (sets.length === 0) return getAccount(id)
  values.push(id)
  const res = await query<BankAccount>(`UPDATE "BankAccount" SET ${sets.join(', ')} WHERE "id" = $${values.length} RETURNING ${COLUMNS}`, values)
  return res.rows[0] ?? null
}

/** Removes the account. Snapshot history is untouched: lines are denormalized. */
export async function deleteAccount(id: string): Promise<boolean> {
  const res = await query(`DELETE FROM "BankAccount" WHERE "id" = $1`, [id])
  return (res.rowCount ?? 0) > 0
}

export interface AccountLastValue {
  usd: string
  eur: string
  date: string
  stale: boolean
}

/** Value of each account in the latest snapshot, keyed by account id. Lines are `<id>:<CURRENCY>`. */
export async function lastValues(): Promise<Map<string, AccountLastValue>> {
  const res = await query<{ id: string; usd: string; eur: string; date: string; stale: boolean }>(
    `SELECT split_part(l."sourceRef", ':', 1) AS "id",
            SUM(l."valueUsd")::text AS "usd", SUM(l."valueEur")::text AS "eur", s."date"::text AS "date", BOOL_OR(l."stale") AS "stale"
       FROM "SnapshotLine" l
       JOIN "Snapshot" s ON s."id" = l."snapshotId"
      WHERE l."sourceType" = 'bank' AND s."id" = (SELECT "id" FROM "Snapshot" ORDER BY "date" DESC LIMIT 1)
      GROUP BY 1, s."date"`
  )
  return new Map(res.rows.map((r) => [r.id, { usd: r.usd, eur: r.eur, date: r.date, stale: r.stale }]))
}
