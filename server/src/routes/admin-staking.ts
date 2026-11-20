import { FastifyPluginAsync } from 'fastify'
import { requireAuth } from '../lib/auth'
import { Decimal } from '../lib/money'
import { createCoinGecko } from '../sources/crypto/providers/coingecko'
import { createPriceProvider } from '../sources/crypto/providers/defillama'
import { createEthCall, createEvmRpc } from '../sources/crypto/providers/evm-rpc'
import { ProviderError, type EvmProvider, type PriceProvider } from '../sources/crypto/providers/types'
import { normalizeAddress, normalizeContract } from '../sources/crypto/validate'
import type { EthCall } from '../sources/smardex/ownership'
import { MAX_TEXT_LENGTH, createPosition, deletePosition, getPosition, lastValues, listPositions, updatePosition } from '../sources/staking/positions'
import { readClaimable } from '../sources/staking/rewards'

export interface AdminStakingOptions {
  /** Overridable for tests. Defaults to public JSON-RPC. Reads the symbol of the staked token. */
  evm?: EvmProvider
  /** Overridable for tests. Defaults to DefiLlama with CoinGecko. Tells whether the token has a price. */
  prices?: PriceProvider
  /** Overridable for tests. Defaults to public JSON-RPC. Checks that a rewards contract answers like a staking contract. */
  ethCall?: EthCall
}

const rewardsSchema = {
  type: 'object',
  required: ['contract', 'wallet'],
  additionalProperties: false,
  properties: { contract: { type: 'string', minLength: 1, maxLength: 100 }, wallet: { type: 'string', minLength: 1, maxLength: 100 } },
} as const

type RewardsInput = { contract: string; wallet: string }

const idParams = {
  type: 'object',
  required: ['id'],
  properties: { id: { type: 'string', minLength: 1, maxLength: 64 } },
} as const

// A plain decimal such as 10000000 or 1234.5. No exponent, no sign: the column holds 18 decimals and 20 digits before the point.
const AMOUNT = /^\d{1,20}(\.\d{1,18})?$/
const amountSchema = { type: 'string', minLength: 1, maxLength: 40 } as const

/** Normalised amount, or null when it is not a positive plain decimal. */
function parseAmount(input: string): string | null {
  const text = input.trim()
  if (!AMOUNT.test(text) || new Decimal(text).isZero()) return null
  return text
}

export const adminStakingRoutes: FastifyPluginAsync<AdminStakingOptions> = async (fastify, options) => {
  // Every admin route needs a session.
  fastify.addHook('preHandler', requireAuth)

  const evm = options.evm ?? createEvmRpc()
  const prices = options.prices ?? createPriceProvider(createCoinGecko())
  const ethCall = options.ethCall ?? createEthCall('eth')

  /** Normalised rewards settings, or the reason they are refused. The contract must answer like a staking contract. */
  async function checkRewards(input: RewardsInput): Promise<{ ok: true; rewards: RewardsInput } | { ok: false; error: string }> {
    const contract = normalizeContract(input.contract)
    if (!contract) return { ok: false, error: 'The rewards contract is not a valid Ethereum address' }
    const wallet = normalizeAddress('eth', input.wallet)
    if (!wallet) return { ok: false, error: 'The wallet is not a valid Ethereum address' }
    const read = await readClaimable(ethCall, contract, wallet)
    if (!read.ok) return { ok: false, error: `This contract cannot report claimable rewards: ${read.error}` }
    return { ok: true, rewards: { contract, wallet } }
  }

  fastify.get('/positions', async () => {
    const [positions, values] = await Promise.all([listPositions(), lastValues()])
    return { positions: positions.map((p) => ({ ...p, lastValue: values.stake.get(p.id) ?? null, rewardsLastValue: values.rewards.get(p.id) ?? null })) }
  })

  fastify.post(
    '/positions',
    {
      schema: {
        body: {
          type: 'object',
          required: ['platform', 'contract', 'amount'],
          additionalProperties: false,
          properties: {
            platform: { type: 'string', minLength: 1, maxLength: MAX_TEXT_LENGTH },
            contract: { type: 'string', minLength: 1, maxLength: 100 },
            amount: amountSchema,
            rewards: rewardsSchema,
          },
        },
      },
      config: { rateLimit: { max: 20, timeWindow: '1 minute' } },
    },
    async (request, reply) => {
      const body = request.body as { platform: string; contract: string; amount: string; rewards?: RewardsInput }
      const platform = body.platform.trim()
      if (!platform) return reply.status(400).send({ error: 'Give the platform a name' })
      const contract = normalizeContract(body.contract)
      if (!contract) return reply.status(400).send({ error: 'Not a valid Ethereum contract address' })
      const amount = parseAmount(body.amount)
      if (!amount) return reply.status(400).send({ error: 'The amount must be a number greater than 0' })
      let rewards: RewardsInput | undefined
      if (body.rewards) {
        const checked = await checkRewards(body.rewards)
        if (!checked.ok) return reply.status(400).send({ error: checked.error })
        rewards = checked.rewards
      }

      try {
        const meta = await evm.getTokenMetadata('eth', contract)
        // The price check only drives the warning. If it fails the position is still added, with priced unknown.
        let priced: boolean | null = null
        try {
          priced = (await prices.getTokenPrices('eth', [contract])).has(contract)
        } catch (err) {
          request.log.warn({ err: (err as Error).message }, 'price check failed while adding a staking position')
        }

        const created = await createPosition({ platform, symbol: meta.symbol, contract, amount, rewardsContract: rewards?.contract, rewardsWallet: rewards?.wallet })
        if (!created) return reply.status(409).send({ error: 'This token is already tracked on this platform. Edit its amount instead.' })
        return reply.status(201).send({
          ...created,
          priced,
          warning: priced === false ? 'No price is known for this token, so it cannot be valued yet.' : null,
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
    '/positions/:id',
    {
      schema: {
        params: idParams,
        body: {
          type: 'object',
          additionalProperties: false,
          minProperties: 1,
          properties: {
            platform: { type: 'string', minLength: 1, maxLength: MAX_TEXT_LENGTH },
            amount: amountSchema,
            active: { type: 'boolean' },
            // null stops tracking rewards.
            rewards: { ...rewardsSchema, type: ['object', 'null'] },
          },
        },
      },
      config: { rateLimit: { max: 60, timeWindow: '1 minute' } },
    },
    async (request, reply) => {
      const { id } = request.params as { id: string }
      const body = request.body as { platform?: string; amount?: string; active?: boolean; rewards?: RewardsInput | null }
      const platform = body.platform?.trim()
      if (body.platform !== undefined && !platform) return reply.status(400).send({ error: 'Give the platform a name' })
      const amount = body.amount === undefined ? undefined : parseAmount(body.amount)
      if (body.amount !== undefined && !amount) return reply.status(400).send({ error: 'The amount must be a number greater than 0' })

      if (!(await getPosition(id))) return reply.status(404).send({ error: 'Position not found' })
      let rewards: RewardsInput | null | undefined
      if (body.rewards) {
        const checked = await checkRewards(body.rewards)
        if (!checked.ok) return reply.status(400).send({ error: checked.error })
        rewards = checked.rewards
      } else if (body.rewards === null) {
        rewards = null
      }
      const updated = await updatePosition(id, { platform, amount: amount ?? undefined, active: body.active, rewards })
      if (updated === 'duplicate') return reply.status(409).send({ error: 'This token is already tracked on that platform' })
      if (!updated) return reply.status(404).send({ error: 'Position not found' })
      return updated
    }
  )

  fastify.delete('/positions/:id', { schema: { params: idParams } }, async (request, reply) => {
    const { id } = request.params as { id: string }
    if (!(await deletePosition(id))) return reply.status(404).send({ error: 'Position not found' })
    return reply.status(204).send()
  })
}
