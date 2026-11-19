import { FastifyPluginAsync } from 'fastify'
import { requireAuth } from '../lib/auth'
import {
  MAX_LABEL_LENGTH,
  createAddress,
  deleteAddress,
  getAddress,
  listAddresses,
  updateAddress,
} from '../sources/crypto/addresses'
import { CHAINS, isChain, normalizeAddress } from '../sources/crypto/validate'

const idParams = {
  type: 'object',
  required: ['id'],
  properties: { id: { type: 'string', minLength: 1, maxLength: 64 } },
} as const

const labelSchema = { type: ['string', 'null'], maxLength: MAX_LABEL_LENGTH } as const

function cleanLabel(label: string | null | undefined): string | null | undefined {
  if (label === undefined || label === null) return label
  return label.trim() || null
}

export const adminCryptoRoutes: FastifyPluginAsync = async (fastify) => {
  // Every admin route needs a session.
  fastify.addHook('preHandler', requireAuth)

  fastify.get('/addresses', async () => ({ addresses: await listAddresses() }))

  fastify.post(
    '/addresses',
    {
      schema: {
        body: {
          type: 'object',
          required: ['chain', 'address'],
          additionalProperties: false,
          properties: {
            chain: { type: 'string', enum: [...CHAINS] },
            address: { type: 'string', minLength: 1, maxLength: 200 },
            label: labelSchema,
          },
        },
      },
    },
    async (request, reply) => {
      const body = request.body as { chain: string; address: string; label?: string | null }
      if (!isChain(body.chain)) return reply.status(400).send({ error: 'Unknown chain' })

      const address = normalizeAddress(body.chain, body.address)
      if (!address) return reply.status(400).send({ error: `Not a valid ${body.chain.toUpperCase()} address` })

      const created = await createAddress({ chain: body.chain, address, label: cleanLabel(body.label) ?? null })
      if (!created) return reply.status(409).send({ error: 'This address is already tracked on this chain' })
      return reply.status(201).send(created)
    }
  )

  fastify.patch(
    '/addresses/:id',
    {
      schema: {
        params: idParams,
        body: {
          type: 'object',
          additionalProperties: false,
          minProperties: 1,
          properties: { label: labelSchema, active: { type: 'boolean' } },
        },
      },
    },
    async (request, reply) => {
      const { id } = request.params as { id: string }
      const body = request.body as { label?: string | null; active?: boolean }
      const updated = await updateAddress(id, { label: cleanLabel(body.label), active: body.active })
      if (!updated) return reply.status(404).send({ error: 'Address not found' })
      return updated
    }
  )

  fastify.delete('/addresses/:id', { schema: { params: idParams } }, async (request, reply) => {
    const { id } = request.params as { id: string }
    if (!(await getAddress(id))) return reply.status(404).send({ error: 'Address not found' })
    await deleteAddress(id)
    return reply.status(204).send()
  })
}
