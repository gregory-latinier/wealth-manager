import { query } from '../../db/index'

export const CURRENCIES = ['EUR', 'USD'] as const
export type Mt5Currency = (typeof CURRENCIES)[number]

export interface Mt5Account {
  login: string
  currency: Mt5Currency
  active: boolean
  createdAt: string
}

const COLUMNS = `"login", "currency", "active", "createdAt"`

export async function listAccounts(): Promise<Mt5Account[]> {
  const res = await query<Mt5Account>(`SELECT ${COLUMNS} FROM "Mt5Account" ORDER BY "createdAt", "login"`)
  return res.rows
}

export async function getAccount(login: string): Promise<Mt5Account | null> {
  const res = await query<Mt5Account>(`SELECT ${COLUMNS} FROM "Mt5Account" WHERE "login" = $1`, [login])
  return res.rows[0] ?? null
}

/** Accounts the snapshot source values. Paused ones are skipped. */
export async function activeAccounts(): Promise<Mt5Account[]> {
  const res = await query<Mt5Account>(`SELECT ${COLUMNS} FROM "Mt5Account" WHERE "active" ORDER BY "createdAt", "login"`)
  return res.rows
}

/** Returns null when the login is already tracked. */
export async function createAccount(login: string, currency: Mt5Currency): Promise<Mt5Account | null> {
  const res = await query<Mt5Account>(`INSERT INTO "Mt5Account" ("login", "currency") VALUES ($1, $2) ON CONFLICT DO NOTHING RETURNING ${COLUMNS}`, [login, currency])
  return res.rows[0] ?? null
}

export async function updateAccount(login: string, patch: { currency?: Mt5Currency; active?: boolean }): Promise<Mt5Account | null> {
  const sets: string[] = []
  const values: unknown[] = []
  const set = (column: string, value: unknown) => {
    values.push(value)
    sets.push(`"${column}" = $${values.length}`)
  }
  if (patch.currency !== undefined) set('currency', patch.currency)
  if (patch.active !== undefined) set('active', patch.active)
  if (sets.length === 0) return getAccount(login)
  values.push(login)
  const res = await query<Mt5Account>(`UPDATE "Mt5Account" SET ${sets.join(', ')} WHERE "login" = $${values.length} RETURNING ${COLUMNS}`, values)
  return res.rows[0] ?? null
}

/** Stops counting the account. Snapshot history is untouched: lines are denormalized. */
export async function deleteAccount(login: string): Promise<boolean> {
  const res = await query(`DELETE FROM "Mt5Account" WHERE "login" = $1`, [login])
  return (res.rowCount ?? 0) > 0
}

export interface AccountLastValue {
  usd: string
  eur: string
  date: string
  stale: boolean
}

/** Value of each account in the latest snapshot, keyed by login. Lines are `<login>:<CURRENCY>`. */
export async function lastValues(): Promise<Map<string, AccountLastValue>> {
  const res = await query<{ login: string; usd: string; eur: string; date: string; stale: boolean }>(
    `SELECT split_part(l."sourceRef", ':', 1) AS "login",
            SUM(l."valueUsd")::text AS "usd", SUM(l."valueEur")::text AS "eur", s."date"::text AS "date", BOOL_OR(l."stale") AS "stale"
       FROM "SnapshotLine" l
       JOIN "Snapshot" s ON s."id" = l."snapshotId"
      WHERE l."sourceType" = 'mt5' AND s."id" = (SELECT "id" FROM "Snapshot" ORDER BY "date" DESC LIMIT 1)
      GROUP BY 1, s."date"`
  )
  return new Map(res.rows.map((r) => [r.login, { usd: r.usd, eur: r.eur, date: r.date, stale: r.stale }]))
}
