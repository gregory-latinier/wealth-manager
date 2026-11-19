import { FastifyPluginAsync } from 'fastify'
import { query } from '../db/index'

export const healthRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get('/health', async (_request, reply) => {
    try {
      await query('SELECT 1')
      return reply.send({ status: 'ok', db: 'up' })
    } catch {
      return reply.status(503).send({ status: 'degraded', db: 'down' })
    }
  })
}
