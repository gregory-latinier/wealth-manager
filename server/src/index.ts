import Fastify, { FastifyInstance } from 'fastify'
import cookie from '@fastify/cookie'
import fastifyStatic from '@fastify/static'
import fs from 'fs'
import path from 'path'
import rateLimit from '@fastify/rate-limit'
import { assertConfig } from './lib/config'
import { query } from './db/index'
import { healthRoutes } from './routes/health'
import { authRoutes } from './routes/auth'
import { dashboardRoutes } from './routes/dashboard'
import { adminCryptoRoutes, type AdminCryptoOptions } from './routes/admin-crypto'
import { snapshotRoutes, type SnapshotRouteOptions } from './routes/snapshots'
import { registerDefaultSources } from './sources/register-defaults'

export interface BuildAppOptions {
  snapshots?: SnapshotRouteOptions
  adminCrypto?: AdminCryptoOptions
  /** Folder of the built client. Defaults to <app>/client/dist in production and to nothing otherwise. */
  clientDist?: string
}

/** On o2switch the artifacts unpack to <app>/server/dist and <app>/client/dist, so the client sits two levels up. */
const DEFAULT_CLIENT_DIST = path.join(__dirname, '../../client/dist')

export async function buildApp(options: BuildAppOptions = {}): Promise<FastifyInstance> {
  const app = Fastify({
    // In production server.js sets WM_LOG_FILE, because Passenger hides stdout on shared hosting.
    logger: process.env.NODE_ENV === 'test' ? false : process.env.WM_LOG_FILE ? { file: process.env.WM_LOG_FILE } : true,
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

  // One process serves the API and the SPA, so there is no CORS and the cookie stays same-origin.
  const clientDist = options.clientDist ?? (process.env.NODE_ENV === 'production' ? DEFAULT_CLIENT_DIST : undefined)
  if (clientDist) {
    if (!fs.existsSync(path.join(clientDist, 'index.html'))) {
      app.log.warn({ clientDist }, 'client build not found, serving the API only')
    } else {
      await app.register(fastifyStatic, { root: clientDist, prefix: '/', wildcard: false })
      // Client-side routes (/login, /admin/crypto) fall back to the SPA. Unknown API paths stay a JSON 404.
      app.setNotFoundHandler((request, reply) => {
        if (request.method !== 'GET' || request.url.startsWith('/api/')) return reply.status(404).send({ error: 'Not found' })
        return reply.sendFile('index.html')
      })
    }
  }

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

  // A wrong DATABASE_URL does not stop the server from listening, so check it now and say so in the log.
  try {
    await query('SELECT 1')
    app.log.info('database connection ok')
  } catch (err) {
    app.log.error({ err }, 'database connection FAILED, check DATABASE_URL and that the user has access to the database')
  }
}

// Passenger loads dist/index.js through server.js and calls start() itself.
if (require.main === module) {
  start()
}
