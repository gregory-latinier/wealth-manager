import { query, withTransaction } from '../../db/index'
import { generateId } from '../../lib/auth'
import type { Chain } from './validate'

export interface CryptoAddress {
  id: string
  label: string | null
  chain: Chain
  address: string
  active: boolean
  createdAt: string
}

const NATIVE: Record<Chain, { symbol: string; decimals: number }> = {
  btc: { symbol: 'BTC', decimals: 8 },
  eth: { symbol: 'ETH', decimals: 18 },
  base: { symbol: 'ETH', decimals: 18 },
}

export const MAX_LABEL_LENGTH = 100

const COLUMNS = `"id", "label", "chain", "address", "active", "createdAt"`

export async function listAddresses(): Promise<CryptoAddress[]> {
  const res = await query<CryptoAddress>(`SELECT ${COLUMNS} FROM "CryptoAddress" ORDER BY "createdAt", "id"`)
  return res.rows
}

export async function getAddress(id: string): Promise<CryptoAddress | null> {
  const res = await query<CryptoAddress>(`SELECT ${COLUMNS} FROM "CryptoAddress" WHERE "id" = $1`, [id])
  return res.rows[0] ?? null
}

/** Returns null when the (chain, address) pair already exists. */
export async function createAddress(input: {
  chain: Chain
  address: string
  label: string | null
}): Promise<CryptoAddress | null> {
  return withTransaction(async (client) => {
    const id = generateId('ca')
    const inserted = await client.query<CryptoAddress>(
      `INSERT INTO "CryptoAddress" ("id", "label", "chain", "address") VALUES ($1, $2, $3, $4)
       ON CONFLICT ("chain", "address") DO NOTHING
       RETURNING ${COLUMNS}`,
      [id, input.label, input.chain, input.address]
    )
    if (inserted.rowCount === 0) return null

    const native = NATIVE[input.chain]
    await client.query(
      `INSERT INTO "CryptoAsset" ("id", "addressId", "kind", "symbol", "decimals") VALUES ($1, $2, 'native', $3, $4)`,
      [generateId('cs'), id, native.symbol, native.decimals]
    )
    return inserted.rows[0]
  })
}

export async function updateAddress(
  id: string,
  patch: { label?: string | null; active?: boolean }
): Promise<CryptoAddress | null> {
  const sets: string[] = []
  const values: unknown[] = []
  if (patch.label !== undefined) {
    values.push(patch.label)
    sets.push(`"label" = $${values.length}`)
  }
  if (patch.active !== undefined) {
    values.push(patch.active)
    sets.push(`"active" = $${values.length}`)
  }
  if (sets.length === 0) return getAddress(id)

  values.push(id)
  const res = await query<CryptoAddress>(
    `UPDATE "CryptoAddress" SET ${sets.join(', ')} WHERE "id" = $${values.length} RETURNING ${COLUMNS}`,
    values
  )
  return res.rows[0] ?? null
}

/** Removes the address and its assets. Snapshot history is untouched: lines are denormalized. */
export async function deleteAddress(id: string): Promise<boolean> {
  const res = await query(`DELETE FROM "CryptoAddress" WHERE "id" = $1`, [id])
  return (res.rowCount ?? 0) > 0
}
