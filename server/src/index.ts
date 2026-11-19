import Fastify, { FastifyInstance } from 'fastify'
import cookie from '@fastify/cookie'
import rateLimit from '@fastify/rate-limit'
import { assertConfig } from './lib/config'
import { healthRoutes } from './routes/health'
import { authRoutes } from './routes/auth'
import { snapshotRoutes, type SnapshotRouteOptions } from './routes/snapshots'

export interface BuildAppOptions {
  snapshots?: SnapshotRouteOptions
}

export async function buildApp(options: BuildAppOptions = {}): Promise<FastifyInstance> {
  const app = Fastify({
    logger: process.env.NODE_ENV !== 'test',
    // Behind Passenger the client address arrives in X-Forwarded-For. Without this every visitor
    // shares the proxy's address and the login rate limit would lock the owner out with the attacker.
    trustProxy: process.env.NODE_ENV === 'production',
  })

  await app.register(cookie)
  await app.register(rateLimit, { max: 200, timeWindow: '1 minute' })

  await app.register(healthRoutes, { prefix: '/api' })
  await app.register(authRoutes, { prefix: '/api/auth' })
  await app.register(snapshotRoutes, { prefix: '/api/snapshots', ...options.snapshots })

  return app
}

export async function start() {
  try {
    assertConfig()
  } catch (err) {
    console.error(`[config] ${(err as Error).message}`)
    process.exit(1)
  }

  const app = await buildApp()
  const port = Number(process.env.PORT) || 3001
  try {
    await app.listen({ port, host: '0.0.0.0' })
  } catch (err) {
    app.log.error(err)
    process.exit(1)
  }
}

// Passenger loads dist/index.js through server.js and calls start() itself.
if (require.main === module) {
  start()
}
