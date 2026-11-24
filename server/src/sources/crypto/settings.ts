import { query } from '../../db/index'
import { Decimal, dec } from '../../lib/money'
import { generateId } from '../../lib/auth'
import type { TokenChain } from './providers/types'

export const DEFAULT_THRESHOLD_USD = '10'
const THRESHOLD_KEY = 'crypto.scanThresholdUsd'
const MAX_THRESHOLD = new Decimal('1000000000')

/** A plain non-negative decimal with at most 2 decimals, e.g. "10" or "2.50". Returns null if invalid. */
export function parseThreshold(value: string): string | null {
  if (!/^\d{1,10}(\.\d{1,2})?$/.test(value)) return null
  const d = dec(value)
  return d.lte(MAX_THRESHOLD) ? d.toString() : null
}

export async function getThresholdUsd(): Promise<string> {
  const res = await query<{ value: string }>(`SELECT "value" FROM "Setting" WHERE "key" = $1`, [THRESHOLD_KEY])
  // A hand-edited bad value must not break scans: fall back to the default.
  return parseThreshold(res.rows[0]?.value ?? '') ?? DEFAULT_THRESHOLD_USD
}

export async function setThresholdUsd(value: string): Promise<void> {
  await query(
    `INSERT INTO "Setting" ("key", "value") VALUES ($1, $2)
     ON CONFLICT ("key") DO UPDATE SET "value" = EXCLUDED."value"`,
    [THRESHOLD_KEY, value]
  )
}

export interface IgnoredToken {
  id: string
  chain: TokenChain
  contractAddress: string
  createdAt: string
}

export async function listIgnored(): Promise<IgnoredToken[]> {
  const res = await query<IgnoredToken>(
    `SELECT "id", "chain", "contractAddress", "createdAt" FROM "IgnoredToken" ORDER BY "createdAt", "id"`
  )
  return res.rows
}

/** Idempotent: ignoring a token twice returns the existing row. */
export async function ignoreToken(chain: TokenChain, contractAddress: string): Promise<IgnoredToken> {
  const res = await query<IgnoredToken>(
    `INSERT INTO "IgnoredToken" ("id", "chain", "contractAddress") VALUES ($1, $2, $3)
     ON CONFLICT ("chain", "contractAddress") DO UPDATE SET "chain" = EXCLUDED."chain"
     RETURNING "id", "chain", "contractAddress", "createdAt"`,
    [generateId('ig'), chain, contractAddress]
  )
  return res.rows[0]
}

export async function unignoreToken(id: string): Promise<boolean> {
  const res = await query(`DELETE FROM "IgnoredToken" WHERE "id" = $1`, [id])
  return (res.rowCount ?? 0) > 0
}
