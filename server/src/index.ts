import Fastify, { FastifyInstance } from 'fastify'
import { healthRoutes } from './routes/health'

export async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({ logger: true })

  await app.register(healthRoutes, { prefix: '/api' })

  return app
}

export async function start() {
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
