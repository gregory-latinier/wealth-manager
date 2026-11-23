import type { PoolClient } from 'pg'
import { withTransaction } from '../db/index'
import { generateId } from './auth'
import { AMOUNT_DP, VALUE_DP, Decimal, dec, fixed, usdToEur } from './money'
import type { FxProvider } from '../sources/fx/frankfurter'
import type { HoldingLine, SourceType } from '../sources/types'

export interface StaleEntry {
  sourceType: string
  sourceRef: string
  staleSince: string
}

export interface LeftOutEntry {
  sourceType: string
  sourceRef: string
  reason: string
}

export interface SnapshotSummary {
  date: string
  status: 'complete' | 'partial'
  usdPerEur: string
  rateStale: boolean
  totalUsd: string
  totalEur: string
  lineCount: number
  /** Entries carried forward from an earlier snapshot because a fresh lookup failed. */
  stale: StaleEntry[]
  /** Entries that failed and had no earlier value to carry forward. They are not in the totals. */
  leftOut: LeftOutEntry[]
}

/** No rate was fetched and none was ever stored, so nothing can be converted to EUR. */
export class NoRateError extends Error {
  constructor(cause: unknown) {
    super(`No USD/EUR rate available and none stored yet: ${cause instanceof Error ? cause.message : String(cause)}`)
  }
}

export interface RunSnapshotOptions {
  sources: SourceType[]
  fx: FxProvider
  /** Defaults to the current time. The snapshot date is the UTC date of this instant. */
  now?: Date
}

interface Failure {
  sourceType: string
  sourceRef: string
  reason: string
}

interface PreviousLine {
  symbol: string
  amount: string
  priceUsd: string
  valueUsd: string
  stale: boolean
  staleSince: string | null
  date: string
}

interface OutLine {
  sourceType: string
  sourceRef: string
  symbol: string
  amount: string
  priceUsd: string
  valueUsd: string
  stale: boolean
  staleSince: string | null
}

// Arbitrary constant: serializes overlapping snapshot writes (e.g. the cron firing twice).
const SNAPSHOT_LOCK_KEY = 872_341_001

export function utcDate(now: Date): string {
  return now.toISOString().slice(0, 10)
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

/** Everything that touches the network happens here, before the transaction opens. */
async function gather(opts: RunSnapshotOptions, date: string) {
  const fxResult = await opts.fx.getUsdPerEur().then(
    (rate) => ({ ok: true as const, rate }),
    (error: unknown) => ({ ok: false as const, error })
  )

  const sourceResults = await Promise.all(
    opts.sources.map(async (source) => {
      try {
        return { source, ok: true as const, result: await source.collect({ date, usdPerEur: fxResult.ok ? fxResult.rate.usdPerEur : undefined }) }
      } catch (error) {
        return { source, ok: false as const, error }
      }
    })
  )
  return { fxResult, sourceResults }
}

async function latestLine(client: PoolClient, sourceType: string, sourceRef: string): Promise<PreviousLine | null> {
  const res = await client.query<PreviousLine>(
    `SELECT l."symbol", l."amount", l."priceUsd", l."valueUsd", l."stale", l."staleSince", s."date"
       FROM "SnapshotLine" l JOIN "Snapshot" s ON s."id" = l."snapshotId"
      WHERE l."sourceType" = $1 AND l."sourceRef" = $2
      ORDER BY s."date" DESC LIMIT 1`,
    [sourceType, sourceRef]
  )
  return res.rows[0] ?? null
}

/** Refs a source had in its most recent snapshot, used when the whole source fails to load. */
async function lastKnownRefs(client: PoolClient, sourceType: string): Promise<string[]> {
  const res = await client.query<{ sourceRef: string }>(
    `SELECT l."sourceRef" FROM "SnapshotLine" l
      WHERE l."sourceType" = $1
        AND l."snapshotId" = (
          SELECT s."id" FROM "Snapshot" s JOIN "SnapshotLine" x ON x."snapshotId" = s."id"
           WHERE x."sourceType" = $1 ORDER BY s."date" DESC LIMIT 1)`,
    [sourceType]
  )
  return res.rows.map((r) => r.sourceRef)
}

/**
 * Takes the snapshot for the current UTC date. Re-running the same day replaces that day's snapshot,
 * so the last run wins and stale lines from an earlier failed run disappear once the lookup works.
 */
export async function runSnapshot(opts: RunSnapshotOptions): Promise<SnapshotSummary> {
  const date = utcDate(opts.now ?? new Date())
  const { fxResult, sourceResults } = await gather(opts, date)

  return withTransaction(async (client) => {
    await client.query('SELECT pg_advisory_xact_lock($1)', [SNAPSHOT_LOCK_KEY])

    // 1. Rate: fresh if possible, otherwise the last stored one (flagged), otherwise give up.
    let usdPerEur: Decimal
    let rateDate: string | null
    let rateStale = false
    if (fxResult.ok) {
      usdPerEur = fxResult.rate.usdPerEur
      rateDate = fxResult.rate.date
    } else {
      const last = await client.query<{ usdPerEur: string; rateDate: string | null; date: string }>(
        `SELECT "usdPerEur", "rateDate", "date" FROM "Snapshot" ORDER BY "date" DESC LIMIT 1`
      )
      if (last.rowCount === 0) throw new NoRateError(fxResult.error)
      usdPerEur = dec(last.rows[0].usdPerEur)
      rateDate = last.rows[0].rateDate ?? last.rows[0].date
      rateStale = true
    }

    // 2. Sort every source's outcome into fresh lines and failures.
    const fresh: Array<{ sourceType: string; line: HoldingLine }> = []
    const failures: Failure[] = []
    for (const r of sourceResults) {
      const sourceType = r.source.id
      if (r.ok) {
        for (const line of r.result.lines) fresh.push({ sourceType, line })
        for (const f of r.result.failures) failures.push({ sourceType, sourceRef: f.sourceRef, reason: f.reason })
      } else {
        const reason = `source failed: ${errorMessage(r.error)}`
        const refs = await lastKnownRefs(client, sourceType)
        if (refs.length === 0) failures.push({ sourceType, sourceRef: '*', reason })
        for (const sourceRef of refs) failures.push({ sourceType, sourceRef, reason })
      }
    }

    // 3. Build the output lines. All reads of earlier snapshots happen before today's row is replaced.
    const out: OutLine[] = []
    const taken = new Set<string>()
    const key = (t: string, ref: string) => `${t}\u0000${ref}`
    const leftOut: LeftOutEntry[] = []

    for (const { sourceType, line } of fresh) {
      if (taken.has(key(sourceType, line.sourceRef))) {
        leftOut.push({ sourceType, sourceRef: line.sourceRef, reason: 'duplicate sourceRef in one run' })
        continue
      }
      taken.add(key(sourceType, line.sourceRef))
      out.push({
        sourceType,
        sourceRef: line.sourceRef,
        symbol: line.symbol,
        amount: fixed(line.amount, AMOUNT_DP),
        priceUsd: fixed(line.priceUsd, AMOUNT_DP),
        valueUsd: fixed(line.amount.mul(line.priceUsd), VALUE_DP),
        stale: false,
        staleSince: null,
      })
    }

    for (const f of failures) {
      if (taken.has(key(f.sourceType, f.sourceRef))) continue // a fresh value already exists
      const prev = f.sourceRef === '*' ? null : await latestLine(client, f.sourceType, f.sourceRef)
      if (!prev) {
        leftOut.push({ sourceType: f.sourceType, sourceRef: f.sourceRef, reason: f.reason })
        continue
      }
      taken.add(key(f.sourceType, f.sourceRef))
      out.push({
        sourceType: f.sourceType,
        sourceRef: f.sourceRef,
        symbol: prev.symbol,
        amount: prev.amount,
        priceUsd: prev.priceUsd,
        valueUsd: prev.valueUsd,
        stale: true,
        staleSince: prev.stale ? prev.staleSince : prev.date,
      })
    }

    // 4. Totals are the sum of the stored (rounded) line values, so they can be re-checked from the rows.
    let totalUsd = new Decimal(0)
    let totalEur = new Decimal(0)
    const rows = out.map((l) => {
      const valueEur = dec(fixed(usdToEur(dec(l.valueUsd), usdPerEur), VALUE_DP))
      totalUsd = totalUsd.plus(l.valueUsd)
      totalEur = totalEur.plus(valueEur)
      return { ...l, valueEur: valueEur.toFixed(VALUE_DP) }
    })

    const stale = out.filter((l) => l.stale)
    const status = stale.length > 0 || leftOut.length > 0 || rateStale ? 'partial' : 'complete'

    // 5. Replace today's snapshot (if any) and write the new one.
    await client.query(`DELETE FROM "Snapshot" WHERE "date" = $1`, [date])
    const snapshotId = generateId('sn')
    await client.query(
      `INSERT INTO "Snapshot" ("id", "date", "usdPerEur", "rateDate", "rateStale", "totalUsd", "totalEur", "status")
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [snapshotId, date, usdPerEur.toFixed(), rateDate, rateStale, totalUsd.toFixed(VALUE_DP), totalEur.toFixed(VALUE_DP), status]
    )
    for (const l of rows) {
      await client.query(
        `INSERT INTO "SnapshotLine"
           ("id", "snapshotId", "sourceType", "sourceRef", "symbol", "amount", "priceUsd", "valueUsd", "valueEur", "stale", "staleSince")
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
        [generateId('sl'), snapshotId, l.sourceType, l.sourceRef, l.symbol, l.amount, l.priceUsd, l.valueUsd, l.valueEur, l.stale, l.staleSince]
      )
    }

    return {
      date,
      status,
      usdPerEur: usdPerEur.toFixed(),
      rateStale,
      totalUsd: totalUsd.toFixed(VALUE_DP),
      totalEur: totalEur.toFixed(VALUE_DP),
      lineCount: rows.length,
      stale: stale.map((l) => ({ sourceType: l.sourceType, sourceRef: l.sourceRef, staleSince: l.staleSince! })),
      leftOut,
    }
  })
}
