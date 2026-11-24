import { FastifyPluginAsync } from 'fastify'
import { requireAuth } from '../lib/auth'
import { COST_CURRENCIES, deleteCostBasis, listCostBasis, setCostBasis, type CostCurrency } from '../sources/cost-basis'

// A plain non-negative decimal with at most 8 decimals. Zero is allowed (an airdrop).
const COST = /^\d{1,19}(\.\d{1,8})?$/

const lineProps = {
  sourceType: { type: 'string', minLength: 1, maxLength: 64 },
  sourceRef: { type: 'string', minLength: 1, maxLength: 300 },
} as const

export const adminCostBasisRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.addHook('preHandler', requireAuth)

  fastify.get('/', async () => ({ costs: await listCostBasis() }))

  // Sets or replaces the total paid for one position, in the currency it was paid in.
  fastify.put(
    '/',
    {
      schema: {
        body: {
          type: 'object',
          required: ['sourceType', 'sourceRef', 'cost', 'currency'],
          additionalProperties: false,
          properties: { ...lineProps, cost: { type: 'string', minLength: 1, maxLength: 32 }, currency: { type: 'string', enum: [...COST_CURRENCIES] } },
        },
      },
      config: { rateLimit: { max: 60, timeWindow: '1 minute' } },
    },
    async (request, reply) => {
      const body = request.body as { sourceType: string; sourceRef: string; cost: string; currency: CostCurrency }
      const cost = body.cost.trim()
      if (!COST.test(cost)) return reply.status(400).send({ error: 'The cost must be a number, 0 or more, with at most 8 decimals' })
      return setCostBasis(body.sourceType, body.sourceRef, cost, body.currency)
    }
  )

  fastify.delete(
    '/',
    { schema: { querystring: { type: 'object', required: ['sourceType', 'sourceRef'], additionalProperties: false, properties: lineProps } } },
    async (request, reply) => {
      const { sourceType, sourceRef } = request.query as { sourceType: string; sourceRef: string }
      if (!(await deleteCostBasis(sourceType, sourceRef))) return reply.status(404).send({ error: 'No cost entered for this position' })
      return reply.status(204).send()
    }
  )
}
