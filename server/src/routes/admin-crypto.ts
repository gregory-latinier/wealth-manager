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
import { createCoinGecko } from '../sources/crypto/providers/coingecko'
import { createEvmRpc } from '../sources/crypto/providers/evm-rpc'
import { ProviderError, type EvmProvider, type PriceProvider } from '../sources/crypto/providers/types'
import { addToken, deleteToken, listTokens, setTokenActive } from '../sources/crypto/tokens'
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
  /** Overridable for tests. Defaults to public JSON-RPC. Reads symbol and decimals for a token. */
  evm?: EvmProvider
  /** Overridable for tests. Defaults to CoinGecko. Tells whether a token has a price. */
  prices?: PriceProvider
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
  const evm = options.evm ?? createEvmRpc()
  const prices = options.prices ?? createCoinGecko()

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

  const tokenParams = {
    type: 'object',
    required: ['id', 'tokenId'],
    properties: { id: { type: 'string', minLength: 1, maxLength: 64 }, tokenId: { type: 'string', minLength: 1, maxLength: 64 } },
  } as const

  fastify.get('/addresses/:id/tokens', { schema: { params: idParams } }, async (request, reply) => {
    const { id } = request.params as { id: string }
    if (!(await getAddress(id))) return reply.status(404).send({ error: 'Address not found' })
    return { tokens: await listTokens(id) }
  })

  // Adds one ERC-20 to track, from a scan selection or by typing a contract. Symbol and decimals come from
  // the chain, never from the client, so a hostile or mistyped value cannot be stored.
  fastify.post(
    '/addresses/:id/tokens',
    {
      schema: {
        params: idParams,
        body: {
          type: 'object',
          required: ['contractAddress'],
          additionalProperties: false,
          properties: { contractAddress: { type: 'string', minLength: 1, maxLength: 100 } },
        },
      },
      config: { rateLimit: { max: 30, timeWindow: '1 minute' } },
    },
    async (request, reply) => {
      const { id } = request.params as { id: string }
      const body = request.body as { contractAddress: string }
      const address = await getAddress(id)
      if (!address) return reply.status(404).send({ error: 'Address not found' })
      if (!isEvmChain(address.chain)) return reply.status(400).send({ error: 'Tokens can only be tracked on Ethereum and Base addresses' })

      const contract = normalizeContract(body.contractAddress)
      if (!contract) return reply.status(400).send({ error: 'Not a valid contract address' })

      try {
        const meta = await evm.getTokenMetadata(address.chain, contract)
        // The price check only drives the "unpriced" warning. If it fails the token is still added, with priced unknown.
        let priced: boolean | null = null
        try {
          priced = (await prices.getTokenPrices(address.chain, [contract])).has(contract)
        } catch (err) {
          request.log.warn({ err: (err as Error).message }, 'price check failed while adding a token')
        }

        const token = await addToken(id, { contractAddress: contract, symbol: meta.symbol, decimals: meta.decimals })
        if (!token) return reply.status(409).send({ error: 'This token is already tracked on this address' })
        return reply.status(201).send({
          ...token,
          priced,
          warning: priced === false ? 'No price is known for this token. It will be valued at 0 until a price exists.' : null,
        })
      } catch (err) {
        if (err instanceof ProviderError) {
          request.log.warn({ err: err.message }, 'token lookup failed')
          return reply.status(502).send({ error: `Could not read this token from the chain: ${err.message}` })
        }
        throw err
      }
    }
  )

  fastify.patch(
    '/addresses/:id/tokens/:tokenId',
    {
      schema: {
        params: tokenParams,
        body: { type: 'object', required: ['active'], additionalProperties: false, properties: { active: { type: 'boolean' } } },
      },
    },
    async (request, reply) => {
      const { id, tokenId } = request.params as { id: string; tokenId: string }
      const updated = await setTokenActive(id, tokenId, (request.body as { active: boolean }).active)
      if (!updated) return reply.status(404).send({ error: 'Token not found' })
      return updated
    }
  )

  fastify.delete('/addresses/:id/tokens/:tokenId', { schema: { params: tokenParams } }, async (request, reply) => {
    const { id, tokenId } = request.params as { id: string; tokenId: string }
    if (!(await deleteToken(id, tokenId))) return reply.status(404).send({ error: 'Token not found' })
    return reply.status(204).send()
  })

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
