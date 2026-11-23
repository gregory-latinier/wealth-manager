import { query } from '../../db/index'
import { generateId } from '../../lib/auth'

export type StockCurrency = 'EUR' | 'USD'

export interface StockHolding {
  id: string
  /** Yahoo ticker of the listing, uppercase, for example JEQP.DE. */
  symbol: string
  name: string
  broker: string
  /** Currency the listing is quoted in. */
  currency: StockCurrency
  /** Fixed-point string with up to 6 decimals, as stored. */
  quantity: string
  active: boolean
  createdAt: string
}

export const MAX_TEXT_LENGTH = 100

const COLUMNS = `"id", "symbol", "name", "broker", "currency", "quantity"::text AS "quantity", "active", "createdAt"`

export async function listHoldings(): Promise<StockHolding[]> {
  const res = await query<StockHolding>(`SELECT ${COLUMNS} FROM "StockHolding" ORDER BY "createdAt", "id"`)
  return res.rows
}

export async function getHolding(id: string): Promise<StockHolding | null> {
  const res = await query<StockHolding>(`SELECT ${COLUMNS} FROM "StockHolding" WHERE "id" = $1`, [id])
  return res.rows[0] ?? null
}

/** Holdings the snapshot source values. Paused ones are skipped. */
export async function activeHoldings(): Promise<StockHolding[]> {
  const res = await query<StockHolding>(`SELECT ${COLUMNS} FROM "StockHolding" WHERE "active" ORDER BY "createdAt", "id"`)
  return res.rows
}

/** Returns null when this listing is already tracked at that broker. */
export async function createHolding(input: { symbol: string; name: string; broker: string; currency: StockCurrency; quantity: string }): Promise<StockHolding | null> {
  const res = await query<StockHolding>(
    `INSERT INTO "StockHolding" ("id", "symbol", "name", "broker", "currency", "quantity") VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT ("symbol", "broker") DO NOTHING
     RETURNING ${COLUMNS}`,
    [generateId('st'), input.symbol, input.name, input.broker, input.currency, input.quantity]
  )
  return res.rows[0] ?? null
}

export type UpdateResult = StockHolding | null | 'duplicate'

/** The symbol and currency are not editable: they are part of the snapshot key and of the valuation. */
export async function updateHolding(id: string, patch: { broker?: string; quantity?: string; active?: boolean }): Promise<UpdateResult> {
  const sets: string[] = []
  const values: unknown[] = []
  const set = (column: string, value: unknown) => {
    values.push(value)
    sets.push(`"${column}" = $${values.length}`)
  }
  if (patch.broker !== undefined) set('broker', patch.broker)
  if (patch.quantity !== undefined) set('quantity', patch.quantity)
  if (patch.active !== undefined) set('active', patch.active)
  if (sets.length === 0) return getHolding(id)
  values.push(id)
  try {
    const res = await query<StockHolding>(`UPDATE "StockHolding" SET ${sets.join(', ')} WHERE "id" = $${values.length} RETURNING ${COLUMNS}`, values)
    return res.rows[0] ?? null
  } catch (err) {
    if ((err as { code?: string }).code === '23505') return 'duplicate'
    throw err
  }
}

/** Removes the holding. Snapshot history is untouched: lines are denormalized. */
export async function deleteHolding(id: string): Promise<boolean> {
  const res = await query(`DELETE FROM "StockHolding" WHERE "id" = $1`, [id])
  return (res.rowCount ?? 0) > 0
}

export interface HoldingLastValue {
  usd: string
  eur: string
  date: string
  stale: boolean
}

/** Value of each holding in the latest snapshot, keyed by holding id. Lines are `<id>:<TICKER>`. */
export async function lastValues(): Promise<Map<string, HoldingLastValue>> {
  const res = await query<{ id: string; usd: string; eur: string; date: string; stale: boolean }>(
    `SELECT split_part(l."sourceRef", ':', 1) AS "id",
            SUM(l."valueUsd")::text AS "usd", SUM(l."valueEur")::text AS "eur", s."date"::text AS "date", BOOL_OR(l."stale") AS "stale"
       FROM "SnapshotLine" l
       JOIN "Snapshot" s ON s."id" = l."snapshotId"
      WHERE l."sourceType" = 'stocks' AND s."id" = (SELECT "id" FROM "Snapshot" ORDER BY "date" DESC LIMIT 1)
      GROUP BY 1, s."date"`
  )
  return new Map(res.rows.map((r) => [r.id, { usd: r.usd, eur: r.eur, date: r.date, stale: r.stale }]))
}
