import { FastifyPluginAsync } from 'fastify'
import { query } from '../db/index'
import { requireAuth } from '../lib/auth'
import { dec, fixed, VALUE_DP } from '../lib/money'

interface SnapshotRow {
  date: string
  status: 'complete' | 'partial'
  usdPerEur: string
  rateStale: boolean
  totalUsd: string
  totalEur: string
}

interface LineRow {
  sourceType: string
  sourceRef: string
  symbol: string
  amount: string
  priceUsd: string
  valueUsd: string
  valueEur: string
  stale: boolean
  staleSince: string | null
}

interface Change {
  /** Date of the snapshot being compared against. */
  since: string
  /** Decimal strings. `pct` is null when the earlier total was 0. */
  usd: { abs: string; pct: string | null }
  eur: { abs: string; pct: string | null }
}

const SNAPSHOT_COLUMNS = `"date"::text AS "date", "status", "usdPerEur"::text AS "usdPerEur", "rateStale", "totalUsd"::text AS "totalUsd", "totalEur"::text AS "totalEur"`

/** Calendar-day arithmetic on a YYYY-MM-DD string, in UTC like the snapshots themselves. */
function shiftDate(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

function diff(now: string, before: string): { abs: string; pct: string | null } {
  const abs = dec(now).minus(before)
  const base = dec(before)
  return { abs: fixed(abs, VALUE_DP), pct: base.isZero() ? null : fixed(abs.div(base).mul(100), 2) }
}

export const dashboardRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.addHook('preHandler', requireAuth)

  // `date` picks the snapshot whose lines are returned as the breakdown. It defaults to the latest one.
  fastify.get(
    '/',
    {
      schema: {
        querystring: {
          type: 'object',
          additionalProperties: false,
          properties: { date: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' } },
        },
      },
    },
    async (request, reply) => {
      const { date } = request.query as { date?: string }

      const series = (await query<SnapshotRow>(`SELECT ${SNAPSHOT_COLUMNS} FROM "Snapshot" ORDER BY "date"`)).rows
      if (series.length === 0) return { latest: null, change: { day: null, week: null }, series: [], breakdown: null }

      const latest = series[series.length - 1]
      const byDate = new Map(series.map((s) => [s.date, s]))

      // Compared against the snapshot exactly 1 or 7 days earlier. If that day has no snapshot there is no
      // honest figure, so it is null rather than a change over some other period.
      const changeSince = (days: number): Change | null => {
        const before = byDate.get(shiftDate(latest.date, -days))
        if (!before) return null
        return { since: before.date, usd: diff(latest.totalUsd, before.totalUsd), eur: diff(latest.totalEur, before.totalEur) }
      }

      const selected = date ? byDate.get(date) : latest
      if (!selected) return reply.status(404).send({ error: 'No snapshot on that date' })

      const lines = (
        await query<LineRow>(
          `SELECT l."sourceType", l."sourceRef", l."symbol", l."amount"::text AS "amount", l."priceUsd"::text AS "priceUsd",
                  l."valueUsd"::text AS "valueUsd", l."valueEur"::text AS "valueEur", l."stale", l."staleSince"::text AS "staleSince"
             FROM "SnapshotLine" l JOIN "Snapshot" s ON s."id" = l."snapshotId"
            WHERE s."date" = $1
            ORDER BY l."valueUsd" DESC, l."sourceRef"`,
          [selected.date]
        )
      ).rows

      return {
        latest,
        change: { day: changeSince(1), week: changeSince(7) },
        series: series.map((s) => ({ date: s.date, totalUsd: s.totalUsd, totalEur: s.totalEur, status: s.status })),
        breakdown: { date: selected.date, status: selected.status, lines },
      }
    }
  )
}
