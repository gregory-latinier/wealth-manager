import Fastify, { FastifyInstance } from 'fastify'
import cookie from '@fastify/cookie'
import rateLimit from '@fastify/rate-limit'
import { assertConfig } from './lib/config'
import { healthRoutes } from './routes/health'
import { authRoutes } from './routes/auth'
import { dashboardRoutes } from './routes/dashboard'
import { adminCryptoRoutes, type AdminCryptoOptions } from './routes/admin-crypto'
import { snapshotRoutes, type SnapshotRouteOptions } from './routes/snapshots'
import { registerDefaultSources } from './sources/register-defaults'

export interface BuildAppOptions {
  snapshots?: SnapshotRouteOptions
  adminCrypto?: AdminCryptoOptions
}

export async function buildApp(options: BuildAppOptions = {}): Promise<FastifyInstance> {
  const app = Fastify({
    logger: process.env.NODE_ENV !== 'test',
    // Behind Passenger the client address arrives in X-Forwarded-For. Without this every visitor
    // shares the proxy's address and the login rate limit would lock the owner out with the attacker.
    trustProxy: process.env.NODE_ENV === 'production',
    // Fastify strips unknown body fields by default. Reject them instead, so a client that sends
    // an immutable or misspelled field gets a 400 rather than a silent no-op.
    ajv: { customOptions: { removeAdditional: false } },
  })

  await app.register(cookie)
  await app.register(rateLimit, { max: 200, timeWindow: '1 minute' })

  await app.register(healthRoutes, { prefix: '/api' })
  await app.register(authRoutes, { prefix: '/api/auth' })
  await app.register(adminCryptoRoutes, { prefix: '/api/admin/crypto', ...options.adminCrypto })
  await app.register(dashboardRoutes, { prefix: '/api/dashboard' })
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

  registerDefaultSources()
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
