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
import { adminAaveRoutes, type AdminAaveOptions } from './routes/admin-aave'
import { pendingMigrations } from './db/pending-migrations'
import { adminBankRoutes } from './routes/admin-bank'
import { adminCostBasisRoutes } from './routes/admin-cost-basis'
import { adminCrowdlendingRoutes } from './routes/admin-crowdlending'
import { adminCryptoRoutes, type AdminCryptoOptions } from './routes/admin-crypto'
import { adminExchangeRoutes, type AdminExchangeOptions } from './routes/admin-exchange'
import { adminGominingRoutes } from './routes/admin-gomining'
import { adminSettingsRoutes } from './routes/admin-settings'
import { adminMt5Routes, type AdminMt5Options } from './routes/admin-mt5'
import { adminStocksRoutes, type AdminStocksOptions } from './routes/admin-stocks'
import { adminSmardexRoutes, type SmardexRouteOptions } from './routes/admin-smardex'
import { adminStakingRoutes, type AdminStakingOptions } from './routes/admin-staking'
import { snapshotRoutes, type SnapshotRouteOptions } from './routes/snapshots'
import { registerDefaultSources } from './sources/register-defaults'

export interface BuildAppOptions {
  snapshots?: SnapshotRouteOptions
  adminAave?: AdminAaveOptions
  adminCrypto?: AdminCryptoOptions
  adminExchange?: AdminExchangeOptions
  adminMt5?: AdminMt5Options
  adminSmardex?: SmardexRouteOptions
  adminStaking?: AdminStakingOptions
  adminStocks?: AdminStocksOptions
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
  await app.register(adminAaveRoutes, { prefix: '/api/admin/aave', ...options.adminAave })
  await app.register(adminBankRoutes, { prefix: '/api/admin/bank' })
  await app.register(adminCostBasisRoutes, { prefix: '/api/admin/cost-basis' })
  await app.register(adminCrowdlendingRoutes, { prefix: '/api/admin/crowdlending' })
  await app.register(adminCryptoRoutes, { prefix: '/api/admin/crypto', ...options.adminCrypto })
  await app.register(adminExchangeRoutes, { prefix: '/api/admin/exchanges', ...options.adminExchange })
  await app.register(adminGominingRoutes, { prefix: '/api/admin/gomining' })
  await app.register(adminMt5Routes, { prefix: '/api/admin/mt5', ...options.adminMt5 })
  await app.register(adminSettingsRoutes, { prefix: '/api/admin/settings' })
  await app.register(adminSmardexRoutes, { prefix: '/api/admin/smardex', ...options.adminSmardex })
  await app.register(adminStakingRoutes, { prefix: '/api/admin/staking', ...options.adminStaking })
  await app.register(adminStocksRoutes, { prefix: '/api/admin/stocks', ...options.adminStocks })
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
    // A new table that was never created shows up as a 500 on some page, far from its cause. Say it here instead, and leave the
    // database alone: running migrations is a decision for the owner.
    const pending = await pendingMigrations()
    if (pending && pending.length > 0) {
      app.log.warn({ pending }, `${pending.length} database migration(s) not applied: run "pnpm db:migrate" (or migrate:prod). Some pages will fail until then.`)
    }
  } catch (err) {
    app.log.error({ err }, 'database connection FAILED, check DATABASE_URL and that the user has access to the database')
  }
}

// Passenger loads dist/index.js through server.js and calls start() itself.
if (require.main === module) {
  start()
}
