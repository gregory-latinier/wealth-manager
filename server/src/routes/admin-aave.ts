import { FastifyPluginAsync } from 'fastify'
import { requireAuth } from '../lib/auth'
import type { Decimal } from '../lib/money'
import { createCoinGecko } from '../sources/crypto/providers/coingecko'
import { createPriceProvider } from '../sources/crypto/providers/defillama'
import { createEthCall, createEvmRpc } from '../sources/crypto/providers/evm-rpc'
import type { EvmProvider, PriceProvider } from '../sources/crypto/providers/types'
import { normalizeAddress } from '../sources/crypto/validate'
import { readWallet } from '../sources/aave/spoke'
import { MAX_LABEL_LENGTH, createWallet, deleteWallet, getWallet, lastValues, listWallets, updateWallet } from '../sources/aave/wallets'
import { reasonOf, type EthCall } from '../sources/smardex/ownership'

const idParams = {
  type: 'object',
  required: ['id'],
  properties: { id: { type: 'string', minLength: 1, maxLength: 64 } },
} as const

export interface AdminAaveOptions {
  /** Overridable for tests. Defaults to public JSON-RPC. */
  ethCall?: EthCall
  evm?: Pick<EvmProvider, 'getTokenMetadata'>
  prices?: Pick<PriceProvider, 'getTokenPrices'>
}

/** One reserve of a wallet as read live from the chain. Numbers are fixed-point strings; usd is null when the asset has no price. */
export interface LiveReserve {
  reserveId: number
  symbol: string
  supplied: string
  debt: string
  suppliedUsd: string | null
  debtUsd: string | null
}

export interface LiveWallet {
  reserves: LiveReserve[]
  /** Collateral over debt. Below 1 the position can be liquidated. Null when nothing is borrowed. */
  healthFactor: string | null
  warnings: string[]
}

export const adminAaveRoutes: FastifyPluginAsync<AdminAaveOptions> = async (fastify, options) => {
  // Every admin route needs a session.
  fastify.addHook('preHandler', requireAuth)

  // Built on first use: it creates RPC and price clients that nothing else in the process needs.
  let ethCall = options.ethCall
  let evm = options.evm
  let prices = options.prices

  // Reads the chain, so it is slower than the list and has its own tighter limit.
  fastify.get(
    '/wallets/:id/positions',
    { schema: { params: idParams }, config: { rateLimit: { max: 20, timeWindow: '1 minute' } } },
    async (request, reply) => {
      const { id } = request.params as { id: string }
      const wallet = await getWallet(id)
      if (!wallet) return reply.status(404).send({ error: 'Wallet not found' })

      ethCall ??= createEthCall('eth')
      evm ??= createEvmRpc()
      prices ??= createPriceProvider(createCoinGecko())
      const warnings: string[] = []
      let reading
      try {
        reading = await readWallet(ethCall, evm, wallet.address)
      } catch (err) {
        request.log.warn({ err: reasonOf(err) }, 'aave read failed')
        return reply.status(502).send({ error: `Could not read the Aave position: ${reasonOf(err)}` })
      }
      for (const f of reading.failures) warnings.push(`Reserve ${f.reserveId} could not be read: ${f.reason}`)

      let usd = new Map<string, Decimal>()
      if (reading.positions.length > 0) {
        try {
          usd = await prices.getTokenPrices('eth', [...new Set(reading.positions.map((p) => p.underlying))])
        } catch (err) {
          warnings.push(`Prices are unavailable: ${reasonOf(err)}`)
        }
      }
      const reserves: LiveReserve[] = reading.positions.map((p) => {
        const price = usd.get(p.underlying)
        return {
          reserveId: p.reserveId,
          symbol: p.symbol,
          supplied: p.supplied.toFixed(),
          debt: p.debt.toFixed(),
          suppliedUsd: price ? p.supplied.mul(price).toFixed(2) : null,
          debtUsd: price ? p.debt.mul(price).toFixed(2) : null,
        }
      })
      const result: LiveWallet = { reserves, healthFactor: reading.healthFactor?.toFixed(4) ?? null, warnings }
      return result
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
      // The Spoke lives on Ethereum mainnet, so only an Ethereum address makes sense.
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
