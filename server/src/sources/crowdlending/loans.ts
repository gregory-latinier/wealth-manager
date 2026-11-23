import { query } from '../../db/index'
import { generateId } from '../../lib/auth'

export interface Loan {
  id: string
  platform: string
  name: string
  /** EUR lent, fixed-point string with 2 decimals. */
  lent: string
  /** EUR still to be refunded, fixed-point string with 2 decimals. 0 once repaid. */
  outstanding: string
  /** Expected refund date, `YYYY-MM-DD`. */
  dueDate: string
  active: boolean
  createdAt: string
}

export const MAX_TEXT_LENGTH = 100

const COLUMNS = `"id", "platform", "name", "lent"::text AS "lent", "outstanding"::text AS "outstanding", "dueDate"::text AS "dueDate", "active", "createdAt"`

export async function listLoans(): Promise<Loan[]> {
  const res = await query<Loan>(`SELECT ${COLUMNS} FROM "CrowdlendingLoan" ORDER BY "dueDate", "createdAt", "id"`)
  return res.rows
}

export async function getLoan(id: string): Promise<Loan | null> {
  const res = await query<Loan>(`SELECT ${COLUMNS} FROM "CrowdlendingLoan" WHERE "id" = $1`, [id])
  return res.rows[0] ?? null
}

/** Loans the snapshot source values. Paused ones are skipped. */
export async function activeLoans(): Promise<Loan[]> {
  const res = await query<Loan>(`SELECT ${COLUMNS} FROM "CrowdlendingLoan" WHERE "active" ORDER BY "createdAt", "id"`)
  return res.rows
}

export async function createLoan(input: { platform: string; name: string; lent: string; outstanding: string; dueDate: string }): Promise<Loan> {
  const res = await query<Loan>(
    `INSERT INTO "CrowdlendingLoan" ("id", "platform", "name", "lent", "outstanding", "dueDate") VALUES ($1, $2, $3, $4, $5, $6) RETURNING ${COLUMNS}`,
    [generateId('cl'), input.platform, input.name, input.lent, input.outstanding, input.dueDate]
  )
  return res.rows[0]!
}

/** The amount lent is not editable: it is a fact of the past. A repayment lowers the outstanding amount. */
export async function updateLoan(
  id: string,
  patch: { platform?: string; name?: string; outstanding?: string; dueDate?: string; active?: boolean }
): Promise<Loan | null> {
  const sets: string[] = []
  const values: unknown[] = []
  const set = (column: string, value: unknown) => {
    values.push(value)
    sets.push(`"${column}" = $${values.length}`)
  }
  if (patch.platform !== undefined) set('platform', patch.platform)
  if (patch.name !== undefined) set('name', patch.name)
  if (patch.outstanding !== undefined) set('outstanding', patch.outstanding)
  if (patch.dueDate !== undefined) set('dueDate', patch.dueDate)
  if (patch.active !== undefined) set('active', patch.active)
  if (sets.length === 0) return getLoan(id)
  values.push(id)
  const res = await query<Loan>(`UPDATE "CrowdlendingLoan" SET ${sets.join(', ')} WHERE "id" = $${values.length} RETURNING ${COLUMNS}`, values)
  return res.rows[0] ?? null
}

/** Removes the loan. Snapshot history is untouched: lines are denormalized. */
export async function deleteLoan(id: string): Promise<boolean> {
  const res = await query(`DELETE FROM "CrowdlendingLoan" WHERE "id" = $1`, [id])
  return (res.rowCount ?? 0) > 0
}

export interface LoanLastValue {
  usd: string
  eur: string
  date: string
  stale: boolean
}

/** Value of each loan in the latest snapshot, keyed by loan id. Lines are `<id>:EUR`. */
export async function lastValues(): Promise<Map<string, LoanLastValue>> {
  const res = await query<{ id: string; usd: string; eur: string; date: string; stale: boolean }>(
    `SELECT split_part(l."sourceRef", ':', 1) AS "id",
            SUM(l."valueUsd")::text AS "usd", SUM(l."valueEur")::text AS "eur", s."date"::text AS "date", BOOL_OR(l."stale") AS "stale"
       FROM "SnapshotLine" l
       JOIN "Snapshot" s ON s."id" = l."snapshotId"
      WHERE l."sourceType" = 'crowdlending' AND s."id" = (SELECT "id" FROM "Snapshot" ORDER BY "date" DESC LIMIT 1)
      GROUP BY 1, s."date"`
  )
  return new Map(res.rows.map((r) => [r.id, { usd: r.usd, eur: r.eur, date: r.date, stale: r.stale }]))
}
