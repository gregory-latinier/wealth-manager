import { query } from '../../db/index'
import { generateId } from '../../lib/auth'

export const MAX_TOKEN_SYMBOL_LENGTH = 32

export interface TrackedToken {
  id: string
  addressId: string
  symbol: string
  contractAddress: string
  decimals: number
  active: boolean
  createdAt: string
}

const COLUMNS = `"id", "addressId", "symbol", "contractAddress", "decimals", "active", "createdAt"`

export async function listTokens(addressId: string): Promise<TrackedToken[]> {
  const res = await query<TrackedToken>(
    `SELECT ${COLUMNS} FROM "CryptoAsset" WHERE "addressId" = $1 AND "kind" = 'token' ORDER BY "createdAt", "id"`,
    [addressId]
  )
  return res.rows
}

/** Returns null when the token is already tracked on this address. */
export async function addToken(
  addressId: string,
  input: { contractAddress: string; symbol: string; decimals: number }
): Promise<TrackedToken | null> {
  const res = await query<TrackedToken>(
    `INSERT INTO "CryptoAsset" ("id", "addressId", "kind", "symbol", "contractAddress", "decimals")
     VALUES ($1, $2, 'token', $3, $4, $5)
     ON CONFLICT ("addressId", COALESCE("contractAddress", '')) DO NOTHING
     RETURNING ${COLUMNS}`,
    [generateId('ct'), addressId, input.symbol.slice(0, MAX_TOKEN_SYMBOL_LENGTH), input.contractAddress, input.decimals]
  )
  return res.rows[0] ?? null
}

export async function setTokenActive(addressId: string, tokenId: string, active: boolean): Promise<TrackedToken | null> {
  const res = await query<TrackedToken>(
    `UPDATE "CryptoAsset" SET "active" = $3 WHERE "id" = $2 AND "addressId" = $1 AND "kind" = 'token' RETURNING ${COLUMNS}`,
    [addressId, tokenId, active]
  )
  return res.rows[0] ?? null
}

/** Removes the tracked token. Snapshot history is untouched: lines are denormalized. */
export async function deleteToken(addressId: string, tokenId: string): Promise<boolean> {
  const res = await query(`DELETE FROM "CryptoAsset" WHERE "id" = $2 AND "addressId" = $1 AND "kind" = 'token'`, [addressId, tokenId])
  return (res.rowCount ?? 0) > 0
}
