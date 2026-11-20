import { FastifyPluginAsync } from 'fastify'
import { requireAuth } from '../lib/auth'
import { normalizeAddress } from '../sources/crypto/validate'
import { createDefaultPositionDetails, type WalletPositions } from '../sources/smardex/details'
import { MAX_LABEL_LENGTH, createWallet, deleteWallet, getWallet, lastValues, listWallets, updateWallet } from '../sources/smardex/wallets'

const idParams = {
  type: 'object',
  required: ['id'],
  properties: { id: { type: 'string', minLength: 1, maxLength: 64 } },
} as const

export interface SmardexRouteOptions {
  /** Reads the open positions of an address live. Replaced in tests. */
  positionDetails?: (address: string) => Promise<WalletPositions>
}

export const adminSmardexRoutes: FastifyPluginAsync<SmardexRouteOptions> = async (fastify, options) => {
  // Every admin route needs a session.
  fastify.addHook('preHandler', requireAuth)

  // Built on first use: it creates RPC and price clients that nothing else in the process needs.
  let readDetails = options.positionDetails
  const positionDetails = (address: string) => (readDetails ??= createDefaultPositionDetails())(address)

  // Reads the chain, so it is slower than the list and has its own tighter limit.
  fastify.get(
    '/wallets/:id/positions',
    { schema: { params: idParams }, config: { rateLimit: { max: 20, timeWindow: '1 minute' } } },
    async (request, reply) => {
      const { id } = request.params as { id: string }
      const wallet = await getWallet(id)
      if (!wallet) return reply.status(404).send({ error: 'Wallet not found' })
      return positionDetails(wallet.address)
    }
  )

  fastify.get('/wallets', async () => {
    const [wallets, values] = await Promise.all([listWallets(), lastValues()])
    return { wallets: wallets.map((w) => ({ ...w, lastValue: values.get(w.address) ?? null })) }
  })

  fastify.post(
    '/wallets',
    {
      schema: {
        body: {
          type: 'object',
          required: ['label', 'address'],
          additionalProperties: false,
          properties: {
            label: { type: 'string', minLength: 1, maxLength: MAX_LABEL_LENGTH },
            address: { type: 'string', minLength: 1, maxLength: 100 },
          },
        },
      },
      config: { rateLimit: { max: 20, timeWindow: '1 minute' } },
    },
    async (request, reply) => {
      const body = request.body as { label: string; address: string }
      const label = body.label.trim()
      if (!label) return reply.status(400).send({ error: 'Give the wallet a name' })
      // Positions live on Ethereum mainnet, so only an Ethereum address makes sense.
      const address = normalizeAddress('eth', body.address)
      if (!address) return reply.status(400).send({ error: 'This is not a valid Ethereum address (0x followed by 40 hex characters)' })

      const created = await createWallet({ label, address })
      if (!created) return reply.status(409).send({ error: 'This wallet is already tracked' })
      return reply.status(201).send(created)
    }
  )

  fastify.patch(
    '/wallets/:id',
    {
      schema: {
        params: idParams,
        body: {
          type: 'object',
          additionalProperties: false,
          minProperties: 1,
          properties: { label: { type: 'string', minLength: 1, maxLength: MAX_LABEL_LENGTH }, active: { type: 'boolean' } },
        },
      },
      config: { rateLimit: { max: 60, timeWindow: '1 minute' } },
    },
    async (request, reply) => {
      const { id } = request.params as { id: string }
      const body = request.body as { label?: string; active?: boolean }
      const label = body.label?.trim()
      if (body.label !== undefined && !label) return reply.status(400).send({ error: 'Give the wallet a name' })
      if (!(await getWallet(id))) return reply.status(404).send({ error: 'Wallet not found' })
      const updated = await updateWallet(id, { label, active: body.active })
      if (!updated) return reply.status(404).send({ error: 'Wallet not found' })
      return updated
    }
  )

  fastify.delete('/wallets/:id', { schema: { params: idParams } }, async (request, reply) => {
    const { id } = request.params as { id: string }
    if (!(await deleteWallet(id))) return reply.status(404).send({ error: 'Wallet not found' })
    return reply.status(204).send()
  })
}
