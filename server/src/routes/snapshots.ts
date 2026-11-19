import crypto from 'crypto'
import { FastifyPluginAsync, FastifyRequest } from 'fastify'
import { getSnapshotToken } from '../lib/config'
import { NoRateError, runSnapshot } from '../lib/snapshot'
import { createFrankfurter, type FxProvider } from '../sources/fx/frankfurter'
import { getSources } from '../sources/registry'
import type { SourceType } from '../sources/types'

export interface SnapshotRouteOptions {
  /** Overridable for tests. Defaults to the registered source types. */
  sources?: () => SourceType[]
  /** Overridable for tests. Defaults to Frankfurter. */
  fx?: FxProvider
}

function sha256(value: string): Buffer {
  return crypto.createHash('sha256').update(value).digest()
}

/** Compares digests, so the comparison takes the same time whatever the length or content of the guess. */
function tokenMatches(request: FastifyRequest): boolean {
  const header = request.headers.authorization
  const match = header ? /^Bearer\s+(.+)$/i.exec(header) : null
  if (!match) return false
  return crypto.timingSafeEqual(sha256(match[1].trim()), sha256(getSnapshotToken()))
}

export const snapshotRoutes: FastifyPluginAsync<SnapshotRouteOptions> = async (fastify, options) => {
  const fx = options.fx ?? createFrankfurter()
  const sources = options.sources ?? getSources

  // Deliberately not requireAuth: the cron has no session, and a session alone must not trigger it.
  fastify.post(
    '/run',
    { config: { rateLimit: { max: 20, timeWindow: '1 minute' } } },
    async (request, reply) => {
      if (!tokenMatches(request)) {
        return reply.status(401).send({ error: 'Unauthorized' })
      }

      try {
        // A partial snapshot is still a successful run, so it returns 200 with the details.
        return reply.send(await runSnapshot({ sources: sources(), fx }))
      } catch (err) {
        if (err instanceof NoRateError) {
          request.log.error({ err }, 'snapshot not written: no USD/EUR rate')
          return reply.status(503).send({ error: err.message })
        }
        throw err
      }
    }
  )
}
