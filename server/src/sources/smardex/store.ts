import { query } from '../../db/index'
import type { DiscoveredPosition } from './abi'

export interface ScanState {
  lastTxHash: string | null
  positions: DiscoveredPosition[]
}

export interface SmardexStore {
  load(address: string): Promise<ScanState>
  /** Adds positions and moves the scan marker in one step, so a marker never gets ahead of what was stored. */
  save(address: string, positions: DiscoveredPosition[], lastTxHash: string): Promise<void>
}

export const pgStore: SmardexStore = {
  async load(address) {
    const scan = await query<{ lastTxHash: string }>(`SELECT "lastTxHash" FROM "SmardexScan" WHERE "address" = $1`, [address])
    const found = await query<{ tick: number; tickVersion: string; index: string; openedAt: Date | null; entryPrice: string | null }>(
      `SELECT "tick", "tickVersion", "index", "openedAt", "entryPrice" FROM "SmardexPosition" WHERE "address" = $1 ORDER BY "foundAt", "tick", "tickVersion", "index"`,
      [address]
    )
    const positions = found.rows.map(({ openedAt, entryPrice, ...id }): DiscoveredPosition => ({
      ...id,
      ...(openedAt && { openedAt: Math.floor(openedAt.getTime() / 1000) }),
      ...(entryPrice && { entryPrice }),
    }))
    return { lastTxHash: scan.rows[0]?.lastTxHash ?? null, positions }
  },

  async save(address, positions, lastTxHash) {
    for (const p of positions) {
      // A later read that finds no opening event (a hand-over from LongFarming) must not erase what is already known.
      await query(
        `INSERT INTO "SmardexPosition" ("address", "tick", "tickVersion", "index", "openedAt", "entryPrice")
         VALUES ($1, $2, $3, $4, to_timestamp($5), $6)
         ON CONFLICT ("address", "tick", "tickVersion", "index") DO UPDATE SET
           "openedAt" = COALESCE(EXCLUDED."openedAt", "SmardexPosition"."openedAt"),
           "entryPrice" = COALESCE(EXCLUDED."entryPrice", "SmardexPosition"."entryPrice")`,
        [address, p.tick, p.tickVersion, p.index, p.openedAt ?? null, p.entryPrice ?? null]
      )
    }
    await query(
      `INSERT INTO "SmardexScan" ("address", "lastTxHash") VALUES ($1, $2)
       ON CONFLICT ("address") DO UPDATE SET "lastTxHash" = EXCLUDED."lastTxHash", "updatedAt" = NOW()`,
      [address, lastTxHash]
    )
  },
}
