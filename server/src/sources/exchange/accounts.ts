import { query } from '../../db/index'
import { generateId } from '../../lib/auth'
import { decryptSecret, encryptSecret } from '../../lib/secrets'
import type { Credentials, ExchangeId } from './types'

/** What the API and the admin page may see. The credentials never leave the server. */
export interface ExchangeAccount {
  id: string
  exchange: ExchangeId
  label: string
  active: boolean
  createdAt: string
}

export const MAX_LABEL_LENGTH = 100

const COLUMNS = `"id", "exchange", "label", "active", "createdAt"`

export async function listAccounts(): Promise<ExchangeAccount[]> {
  const res = await query<ExchangeAccount>(`SELECT ${COLUMNS} FROM "ExchangeAccount" ORDER BY "createdAt", "id"`)
  return res.rows
}

export async function getAccount(id: string): Promise<ExchangeAccount | null> {
  const res = await query<ExchangeAccount>(`SELECT ${COLUMNS} FROM "ExchangeAccount" WHERE "id" = $1`, [id])
  return res.rows[0] ?? null
}

/** Encrypted with the account id as context, so the ciphertext only opens for its own row. */
const seal = (credentials: Credentials, id: string) => encryptSecret(JSON.stringify(credentials), id)

/** Returns null when this exchange already has an account with that label. */
export async function createAccount(input: { exchange: ExchangeId; label: string; credentials: Credentials }): Promise<ExchangeAccount | null> {
  const id = generateId('ex')
  const res = await query<ExchangeAccount>(
    `INSERT INTO "ExchangeAccount" ("id", "exchange", "label", "credentials") VALUES ($1, $2, $3, $4)
     ON CONFLICT ("exchange", "label") DO NOTHING
     RETURNING ${COLUMNS}`,
    [id, input.exchange, input.label, seal(input.credentials, id)]
  )
  return res.rows[0] ?? null
}

export type UpdateResult = ExchangeAccount | null | 'duplicate'

export async function updateAccount(
  id: string,
  patch: { label?: string; active?: boolean; credentials?: Credentials }
): Promise<UpdateResult> {
  const sets: string[] = []
  const values: unknown[] = []
  const set = (column: string, value: unknown) => {
    values.push(value)
    sets.push(`"${column}" = $${values.length}`)
  }
  if (patch.label !== undefined) set('label', patch.label)
  if (patch.active !== undefined) set('active', patch.active)
  if (patch.credentials !== undefined) set('credentials', seal(patch.credentials, id))
  if (sets.length === 0) return getAccount(id)

  values.push(id)
  try {
    const res = await query<ExchangeAccount>(`UPDATE "ExchangeAccount" SET ${sets.join(', ')} WHERE "id" = $${values.length} RETURNING ${COLUMNS}`, values)
    return res.rows[0] ?? null
  } catch (err) {
    if ((err as { code?: string }).code === '23505') return 'duplicate'
    throw err
  }
}

/** Removes the account and its stored key. Snapshot history is untouched: lines are denormalized. */
export async function deleteAccount(id: string): Promise<boolean> {
  const res = await query(`DELETE FROM "ExchangeAccount" WHERE "id" = $1`, [id])
  return (res.rowCount ?? 0) > 0
}

export interface ActiveAccount extends ExchangeAccount {
  credentials: Credentials
}

/** Active accounts with their credentials decrypted. Only the snapshot source calls this. */
export async function loadActiveAccounts(): Promise<Array<{ account: ExchangeAccount; credentials: () => Credentials }>> {
  const res = await query<ExchangeAccount & { credentials: string }>(
    `SELECT ${COLUMNS}, "credentials" FROM "ExchangeAccount" WHERE "active" ORDER BY "createdAt", "id"`
  )
  // Decrypting is lazy: one account that cannot be decrypted fails alone instead of failing the whole source.
  return res.rows.map(({ credentials, ...account }) => ({
    account,
    credentials: () => JSON.parse(decryptSecret(credentials, account.id)) as Credentials,
  }))
}

export interface AccountLastValue {
  usd: string
  eur: string
  date: string
  stale: boolean
}

/** Value of each account in the latest snapshot, keyed by account id. Lines are `exchange:accountId:SYMBOL`. */
export async function lastValues(): Promise<Map<string, AccountLastValue>> {
  const res = await query<{ id: string; usd: string; eur: string; date: string; stale: boolean }>(
    `SELECT split_part(l."sourceRef", ':', 2) AS "id",
            SUM(l."valueUsd")::text AS "usd", SUM(l."valueEur")::text AS "eur", s."date"::text AS "date", BOOL_OR(l."stale") AS "stale"
       FROM "SnapshotLine" l
       JOIN "Snapshot" s ON s."id" = l."snapshotId"
      WHERE l."sourceType" = 'exchange' AND s."id" = (SELECT "id" FROM "Snapshot" ORDER BY "date" DESC LIMIT 1)
      GROUP BY 1, s."date"`
  )
  return new Map(res.rows.map((r) => [r.id, { usd: r.usd, eur: r.eur, date: r.date, stale: r.stale }]))
}
