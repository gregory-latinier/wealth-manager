import { FastifyPluginAsync } from 'fastify'
import { requireAuth } from '../lib/auth'
import { SecretsNotConfiguredError, secretsConfigured } from '../lib/secrets'
import { ProviderError } from '../sources/crypto/providers/types'
import {
  MAX_LABEL_LENGTH,
  createAccount,
  deleteAccount,
  getAccount,
  lastValues,
  listAccounts,
  updateAccount,
} from '../sources/exchange/accounts'
import { createDefaultAdapters, type ExchangeAdapters } from '../sources/exchange'
import { EXCHANGE_LABEL, type Credentials, type ExchangeId } from '../sources/exchange/types'

export interface AdminExchangeOptions {
  /** Overridable for tests. Defaults to the real exchanges. The keys of this map are the exchanges the app supports. */
  adapters?: ExchangeAdapters
}

const idParams = {
  type: 'object',
  required: ['id'],
  properties: { id: { type: 'string', minLength: 1, maxLength: 64 } },
} as const

const MAX_SECRET_LENGTH = 512

const credentialsSchema = {
  type: 'object',
  required: ['apiKey', 'apiSecret'],
  additionalProperties: false,
  properties: {
    apiKey: { type: 'string', minLength: 1, maxLength: MAX_SECRET_LENGTH },
    apiSecret: { type: 'string', minLength: 1, maxLength: MAX_SECRET_LENGTH },
    passphrase: { type: 'string', maxLength: MAX_SECRET_LENGTH },
  },
} as const

/** Keys are pasted from a web page, so stray spaces and newlines are common. Anything else odd is rejected. */
function cleanCredentials(input: Credentials): Credentials | null {
  const apiKey = input.apiKey.trim()
  const apiSecret = input.apiSecret.trim()
  const passphrase = input.passphrase?.trim()
  const printable = /^[\x21-\x7e]+$/
  if (!printable.test(apiKey) || !printable.test(apiSecret)) return null
  if (passphrase !== undefined && passphrase !== '' && !/^[\x20-\x7e]+$/.test(passphrase)) return null
  return passphrase ? { apiKey, apiSecret, passphrase } : { apiKey, apiSecret }
}

export const adminExchangeRoutes: FastifyPluginAsync<AdminExchangeOptions> = async (fastify, options) => {
  const adapters = options.adapters ?? createDefaultAdapters()
  const supported = Object.keys(adapters) as ExchangeId[]

  // Every admin route needs a session.
  fastify.addHook('preHandler', requireAuth)

  fastify.get('/accounts', async () => {
    const [accounts, values] = await Promise.all([listAccounts(), lastValues()])
    return {
      // Without EXCHANGE_KEY_SECRET nothing can be stored, and the page says so instead of failing on save.
      ready: secretsConfigured(),
      exchanges: supported.map((id) => ({ id, label: EXCHANGE_LABEL[id] })),
      accounts: accounts.map((a) => ({ ...a, lastValue: values.get(a.id) ?? null })),
    }
  })

  // Checks the credentials against the exchange first, so a wrong or read-less key is never saved.
  async function verify(exchange: ExchangeId, credentials: Credentials, log: { warn: (o: object, m: string) => void }) {
    try {
      await adapters[exchange]!.verify(credentials)
      return null
    } catch (err) {
      if (!(err instanceof ProviderError)) throw err
      log.warn({ err: err.message, exchange }, 'exchange credentials check failed')
      // An answer from the exchange means the key is wrong. No answer means try again later.
      return err.kind === 'rpc'
        ? { status: 400, error: `${EXCHANGE_LABEL[exchange]} did not accept this key: ${err.message}` }
        : { status: 502, error: `Could not reach ${EXCHANGE_LABEL[exchange]} to check the key: ${err.message}` }
    }
  }

  fastify.post(
    '/accounts',
    {
      schema: {
        body: {
          type: 'object',
          required: ['exchange', 'label', 'credentials'],
          additionalProperties: false,
          properties: {
            exchange: { type: 'string', minLength: 1, maxLength: 20 },
            label: { type: 'string', minLength: 1, maxLength: MAX_LABEL_LENGTH },
            credentials: credentialsSchema,
          },
        },
      },
      config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
    },
    async (request, reply) => {
      const body = request.body as { exchange: string; label: string; credentials: Credentials }
      if (!supported.includes(body.exchange as ExchangeId)) return reply.status(400).send({ error: 'Unknown exchange' })
      const exchange = body.exchange as ExchangeId
      const label = body.label.trim()
      if (!label) return reply.status(400).send({ error: 'Give the account a name' })
      const credentials = cleanCredentials(body.credentials)
      if (!credentials) return reply.status(400).send({ error: 'The key or secret contains characters an API key never has. Copy it again.' })
      if (!secretsConfigured()) return reply.status(503).send({ error: 'EXCHANGE_KEY_SECRET is not set on the server, so keys cannot be stored safely.' })

      const rejected = await verify(exchange, credentials, request.log)
      if (rejected) return reply.status(rejected.status).send({ error: rejected.error })

      try {
        const created = await createAccount({ exchange, label, credentials })
        if (!created) return reply.status(409).send({ error: `There is already a ${EXCHANGE_LABEL[exchange]} account with this name` })
        return reply.status(201).send(created)
      } catch (err) {
        if (err instanceof SecretsNotConfiguredError) return reply.status(503).send({ error: err.message })
        throw err
      }
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
          properties: { label: { type: 'string', minLength: 1, maxLength: MAX_LABEL_LENGTH }, active: { type: 'boolean' }, credentials: credentialsSchema },
        },
      },
      config: { rateLimit: { max: 20, timeWindow: '1 minute' } },
    },
    async (request, reply) => {
      const { id } = request.params as { id: string }
      const body = request.body as { label?: string; active?: boolean; credentials?: Credentials }
      const existing = await getAccount(id)
      if (!existing) return reply.status(404).send({ error: 'Account not found' })

      const label = body.label?.trim()
      if (body.label !== undefined && !label) return reply.status(400).send({ error: 'Give the account a name' })

      let credentials: Credentials | undefined
      if (body.credentials) {
        const cleaned = cleanCredentials(body.credentials)
        if (!cleaned) return reply.status(400).send({ error: 'The key or secret contains characters an API key never has. Copy it again.' })
        if (!secretsConfigured()) return reply.status(503).send({ error: 'EXCHANGE_KEY_SECRET is not set on the server, so keys cannot be stored safely.' })
        const rejected = await verify(existing.exchange, cleaned, request.log)
        if (rejected) return reply.status(rejected.status).send({ error: rejected.error })
        credentials = cleaned
      }

      const updated = await updateAccount(id, { label, active: body.active, credentials })
      if (updated === 'duplicate') return reply.status(409).send({ error: `There is already a ${EXCHANGE_LABEL[existing.exchange]} account with this name` })
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
