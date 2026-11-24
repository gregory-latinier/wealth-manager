import { FastifyPluginAsync } from 'fastify'
import { requireAuth } from '../lib/auth'
import { GMT_CONTRACT, WALLET_BTC_REF, WALLET_GMT_REF, minerRef } from '../sources/gomining/index'
import { MAX_NAME_LENGTH, createMiner, deleteMiner, getMiner, lastValues, listMiners, parseTh, updateMiner } from '../sources/gomining/miners'
import { CURRENCIES, getGominingSettings, parseBtc, parseGmt, parseThPrice, saveGominingSettings, type ThCurrency } from '../sources/gomining/settings'

const idParams = {
  type: 'object',
  required: ['id'],
  properties: { id: { type: 'string', minLength: 1, maxLength: 50 } },
} as const

const nameSchema = { type: 'string', minLength: 1, maxLength: MAX_NAME_LENGTH } as const
const amountSchema = { type: 'string', maxLength: 40 } as const

export const adminGominingRoutes: FastifyPluginAsync = async (fastify) => {
  // Every admin route needs a session.
  fastify.addHook('preHandler', requireAuth)

  // The whole page in one call: miners, the value per TH, the wallet, and what each was worth in the latest snapshot.
  fastify.get('/', async () => {
    const [miners, settings, values] = await Promise.all([listMiners(), getGominingSettings(), lastValues()])
    return {
      miners: miners.map((m) => ({ ...m, lastValue: values.get(minerRef(m)) ?? null })),
      settings,
      wallet: { btc: values.get(WALLET_BTC_REF) ?? null, gmt: values.get(WALLET_GMT_REF) ?? null },
      gmtContract: GMT_CONTRACT,
    }
  })

  // Only the fields sent change. An empty price forgets it, an empty balance means none held.
  fastify.put(
    '/settings',
    {
      schema: {
        body: {
          type: 'object',
          additionalProperties: false,
          minProperties: 1,
          properties: { thPrice: amountSchema, thCurrency: { type: 'string', enum: [...CURRENCIES] }, btc: amountSchema, gmt: amountSchema },
        },
      },
      config: { rateLimit: { max: 30, timeWindow: '1 minute' } },
    },
    async (request, reply) => {
      const body = request.body as { thPrice?: string; thCurrency?: ThCurrency; btc?: string; gmt?: string }
      const patch: Parameters<typeof saveGominingSettings>[0] = { thCurrency: body.thCurrency }

      if (body.thPrice !== undefined) {
        if (body.thPrice.trim() === '') patch.thPrice = null
        else {
          const price = parseThPrice(body.thPrice)
          if (price === null) return reply.status(400).send({ error: 'The value per TH must be a positive number with at most 4 decimals' })
          patch.thPrice = price
        }
      }
      if (body.btc !== undefined) {
        const btc = body.btc.trim() === '' ? '0' : parseBtc(body.btc)
        if (btc === null) return reply.status(400).send({ error: 'The BTC balance must be a positive number with at most 8 decimals' })
        patch.btc = btc
      }
      if (body.gmt !== undefined) {
        const gmt = body.gmt.trim() === '' ? '0' : parseGmt(body.gmt)
        if (gmt === null) return reply.status(400).send({ error: 'The GMT balance must be a positive number with at most 8 decimals' })
        patch.gmt = gmt
      }

      await saveGominingSettings(patch)
      return getGominingSettings()
    }
  )

  fastify.post(
    '/miners',
    {
      schema: { body: { type: 'object', required: ['name', 'th'], additionalProperties: false, properties: { name: nameSchema, th: amountSchema } } },
      config: { rateLimit: { max: 20, timeWindow: '1 minute' } },
    },
    async (request, reply) => {
      const body = request.body as { name: string; th: string }
      const name = body.name.trim()
      if (name === '') return reply.status(400).send({ error: 'A miner needs a name' })
      const th = parseTh(body.th)
      if (th === null) return reply.status(400).send({ error: 'The TH must be a positive number with at most 4 decimals' })
      return reply.status(201).send(await createMiner({ name, th }))
    }
  )

  fastify.patch(
    '/miners/:id',
    {
      schema: {
        params: idParams,
        body: { type: 'object', additionalProperties: false, minProperties: 1, properties: { name: nameSchema, th: amountSchema, active: { type: 'boolean' } } },
      },
      config: { rateLimit: { max: 60, timeWindow: '1 minute' } },
    },
    async (request, reply) => {
      const { id } = request.params as { id: string }
      const body = request.body as { name?: string; th?: string; active?: boolean }
      const patch: { name?: string; th?: string; active?: boolean } = { active: body.active }

      if (body.name !== undefined) {
        const name = body.name.trim()
        if (name === '') return reply.status(400).send({ error: 'A miner needs a name' })
        patch.name = name
      }
      if (body.th !== undefined) {
        const th = parseTh(body.th)
        if (th === null) return reply.status(400).send({ error: 'The TH must be a positive number with at most 4 decimals' })
        patch.th = th
      }

      if (!(await getMiner(id))) return reply.status(404).send({ error: 'Miner not found' })
      const updated = await updateMiner(id, patch)
      if (!updated) return reply.status(404).send({ error: 'Miner not found' })
      return updated
    }
  )

  fastify.delete('/miners/:id', { schema: { params: idParams } }, async (request, reply) => {
    const { id } = request.params as { id: string }
    if (!(await deleteMiner(id))) return reply.status(404).send({ error: 'Miner not found' })
    return reply.status(204).send()
  })
}
