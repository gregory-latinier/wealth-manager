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
import { createBlockscout, type ScanProvider } from '../sources/crypto/providers/blockscout'
import { ProviderError } from '../sources/crypto/providers/types'
import { scanAddress } from '../sources/crypto/scan'
import {
  getThresholdUsd,
  ignoreToken,
  listIgnored,
  parseThreshold,
  setThresholdUsd,
  unignoreToken,
} from '../sources/crypto/settings'
import { CHAINS, isChain, isEvmChain, normalizeAddress, normalizeContract } from '../sources/crypto/validate'

export interface AdminCryptoOptions {
  /** Overridable for tests. Defaults to Blockscout. */
  scan?: ScanProvider
}

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

export const adminCryptoRoutes: FastifyPluginAsync<AdminCryptoOptions> = async (fastify, options) => {
  const scanProvider = options.scan ?? createBlockscout()

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

  // Scanning is slow on big wallets (about 25 s) and calls an external service, so it is rate limited.
  fastify.post(
    '/addresses/:id/scan',
    { schema: { params: idParams }, config: { rateLimit: { max: 10, timeWindow: '1 minute' } } },
    async (request, reply) => {
      const { id } = request.params as { id: string }
      const address = await getAddress(id)
      if (!address) return reply.status(404).send({ error: 'Address not found' })
      try {
        return await scanAddress(address, scanProvider)
      } catch (err) {
        if (err instanceof ProviderError) {
          request.log.warn({ err: err.message }, 'token scan failed')
          return reply.status(502).send({ error: `Token scan failed: ${err.message}` })
        }
        throw err
      }
    }
  )

  fastify.get('/settings', async () => ({ scanThresholdUsd: await getThresholdUsd() }))

  fastify.put(
    '/settings',
    {
      schema: {
        body: {
          type: 'object',
          required: ['scanThresholdUsd'],
          additionalProperties: false,
          properties: { scanThresholdUsd: { type: 'string', minLength: 1, maxLength: 16 } },
        },
      },
    },
    async (request, reply) => {
      const body = request.body as { scanThresholdUsd: string }
      const threshold = parseThreshold(body.scanThresholdUsd.trim())
      if (!threshold) return reply.status(400).send({ error: 'Threshold must be a number of USD, 0 or more, with at most 2 decimals' })
      await setThresholdUsd(threshold)
      return { scanThresholdUsd: threshold }
    }
  )

  fastify.get('/ignored-tokens', async () => ({ ignored: await listIgnored() }))

  fastify.post(
    '/ignored-tokens',
    {
      schema: {
        body: {
          type: 'object',
          required: ['chain', 'contractAddress'],
          additionalProperties: false,
          properties: {
            chain: { type: 'string', enum: ['eth', 'base'] },
            contractAddress: { type: 'string', minLength: 1, maxLength: 100 },
          },
        },
      },
    },
    async (request, reply) => {
      const body = request.body as { chain: string; contractAddress: string }
      if (!isChain(body.chain) || !isEvmChain(body.chain)) return reply.status(400).send({ error: 'Unknown chain' })
      const contract = normalizeContract(body.contractAddress)
      if (!contract) return reply.status(400).send({ error: 'Not a valid contract address' })
      return reply.status(201).send(await ignoreToken(body.chain, contract))
    }
  )

  fastify.delete('/ignored-tokens/:id', { schema: { params: idParams } }, async (request, reply) => {
    const { id } = request.params as { id: string }
    if (!(await unignoreToken(id))) return reply.status(404).send({ error: 'Ignored token not found' })
    return reply.status(204).send()
  })
}
