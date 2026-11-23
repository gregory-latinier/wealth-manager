import { FastifyPluginAsync } from 'fastify'
import { requireAuth } from '../lib/auth'
import { CURRENCIES, MAX_TEXT_LENGTH, createAccount, deleteAccount, getAccount, lastValues, listAccounts, updateAccount } from '../sources/bank/accounts'

const idParams = {
  type: 'object',
  required: ['id'],
  properties: { id: { type: 'string', minLength: 1, maxLength: 64 } },
} as const

// A plain decimal with at most 2 decimals, such as 1250 or -80.5. Negative is an overdraft, zero is an empty account.
const BALANCE = /^-?\d{1,18}(\.\d{1,2})?$/
const balanceSchema = { type: 'string', minLength: 1, maxLength: 24 } as const

const textSchema = { type: 'string', minLength: 1, maxLength: MAX_TEXT_LENGTH } as const

export const adminBankRoutes: FastifyPluginAsync = async (fastify) => {
  // Every admin route needs a session.
  fastify.addHook('preHandler', requireAuth)

  fastify.get('/accounts', async () => {
    const [accounts, values] = await Promise.all([listAccounts(), lastValues()])
    return { accounts: accounts.map((a) => ({ ...a, lastValue: values.get(a.id) ?? null })) }
  })

  fastify.post(
    '/accounts',
    {
      schema: {
        body: {
          type: 'object',
          required: ['name', 'currency', 'balance'],
          additionalProperties: false,
          properties: {
            name: textSchema,
            bank: { type: 'string', maxLength: MAX_TEXT_LENGTH },
            currency: { type: 'string', enum: [...CURRENCIES] },
            balance: balanceSchema,
          },
        },
      },
      config: { rateLimit: { max: 20, timeWindow: '1 minute' } },
    },
    async (request, reply) => {
      const body = request.body as { name: string; bank?: string; currency: (typeof CURRENCIES)[number]; balance: string }
      const name = body.name.trim()
      if (!name) return reply.status(400).send({ error: 'Give the account a name' })
      const balance = body.balance.trim()
      if (!BALANCE.test(balance)) return reply.status(400).send({ error: 'The balance must be a number with at most 2 decimals, for example 1250.50' })
      const created = await createAccount({ name, bank: body.bank?.trim() ?? '', currency: body.currency, balance })
      return reply.status(201).send(created)
    }
  )

  fastify.patch(
    '/accounts/:id',
    {
      schema: {
        params: idParams,
        body: {
          type: 'object',
          additionalProperties: false,
          minProperties: 1,
          properties: { name: textSchema, bank: { type: 'string', maxLength: MAX_TEXT_LENGTH }, balance: balanceSchema, active: { type: 'boolean' } },
        },
      },
      config: { rateLimit: { max: 60, timeWindow: '1 minute' } },
    },
    async (request, reply) => {
      const { id } = request.params as { id: string }
      const body = request.body as { name?: string; bank?: string; balance?: string; active?: boolean }
      const name = body.name?.trim()
      if (body.name !== undefined && !name) return reply.status(400).send({ error: 'Give the account a name' })
      const balance = body.balance?.trim()
      if (balance !== undefined && !BALANCE.test(balance)) {
        return reply.status(400).send({ error: 'The balance must be a number with at most 2 decimals, for example 1250.50' })
      }
      if (!(await getAccount(id))) return reply.status(404).send({ error: 'Account not found' })
      const updated = await updateAccount(id, { name, bank: body.bank?.trim(), balance, active: body.active })
      if (!updated) return reply.status(404).send({ error: 'Account not found' })
      return updated
    }
  )

  fastify.delete('/accounts/:id', { schema: { params: idParams } }, async (request, reply) => {
    const { id } = request.params as { id: string }
    if (!(await deleteAccount(id))) return reply.status(404).send({ error: 'Account not found' })
    return reply.status(204).send()
  })
}
