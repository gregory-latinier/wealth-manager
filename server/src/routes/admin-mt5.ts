import { FastifyPluginAsync } from 'fastify'
import { requireAuth } from '../lib/auth'
import { CURRENCIES, createAccount, deleteAccount, getAccount, lastValues, listAccounts, updateAccount, type Mt5Currency } from '../sources/mt5/accounts'
import { FeedNotConfiguredError, createMt5Feed, type Mt5Feed } from '../sources/mt5/feed'
import { MAX_FEED_URL_LENGTH, feedUrlSource, getFeedUrl, parseFeedUrl, setFeedUrl } from '../sources/mt5/settings'
import { reasonOf } from '../sources/smardex/ownership'

export interface AdminMt5Options {
  /** Overridable for tests. Defaults to the public accounts-monitoring snapshot. */
  feed?: Mt5Feed
}

const loginParams = {
  type: 'object',
  required: ['login'],
  properties: { login: { type: 'string', minLength: 1, maxLength: 20 } },
} as const

// An MT5 login is a number.
const LOGIN = /^\d{1,15}$/
const currencySchema = { type: 'string', enum: [...CURRENCIES] } as const

export const adminMt5Routes: FastifyPluginAsync<AdminMt5Options> = async (fastify, options) => {
  // Every admin route needs a session.
  fastify.addHook('preHandler', requireAuth)

  const feed = options.feed ?? createMt5Feed()

  const feedSettings = async () => ({ feedUrl: await getFeedUrl(), feedUrlSource: await feedUrlSource() })

  fastify.get('/settings', feedSettings)

  // An empty url forgets the stored one. The environment variable MT5_FEED_URL then applies again, if set.
  fastify.put(
    '/settings',
    {
      schema: { body: { type: 'object', required: ['feedUrl'], additionalProperties: false, properties: { feedUrl: { type: 'string', maxLength: MAX_FEED_URL_LENGTH } } } },
      config: { rateLimit: { max: 20, timeWindow: '1 minute' } },
    },
    async (request, reply) => {
      const { feedUrl } = request.body as { feedUrl: string }
      if (feedUrl.trim() === '') {
        await setFeedUrl(null)
      } else {
        const url = parseFeedUrl(feedUrl)
        if (!url) return reply.status(400).send({ error: 'The feed URL must be a full http or https address, without a user name or password' })
        await setFeedUrl(url)
      }
      return feedSettings()
    }
  )

  // Every account the feed knows, with what the owner chose for it. A tracked account the feed no longer lists is kept, so it can be removed.
  fastify.get('/accounts', async (request) => {
    const [tracked, values] = await Promise.all([listAccounts(), lastValues()])
    let fromFeed: Awaited<ReturnType<Mt5Feed['accounts']>> = []
    let feedError: string | null = null
    let feedConfigured = true
    try {
      fromFeed = await feed.accounts()
    } catch (err) {
      if (err instanceof FeedNotConfiguredError) {
        feedConfigured = false
      } else {
        request.log.warn({ err: reasonOf(err) }, 'MT5 feed unavailable')
      }
      feedError = reasonOf(err)
    }

    const byLogin = new Map(tracked.map((a) => [a.login, a]))
    const view = (login: string) => {
      const t = byLogin.get(login)
      return { tracked: t ? { currency: t.currency, active: t.active, lastValue: values.get(login) ?? null } : null }
    }
    const listed = new Set(fromFeed.map((a) => a.login))
    const accounts = [
      ...fromFeed.map((a) => ({
        login: a.login,
        name: a.name,
        broker: a.broker,
        balance: a.balance?.toFixed() ?? null,
        problem: a.problem,
        updatedAt: a.updatedAt?.toISOString() ?? null,
        inFeed: true,
        ...view(a.login),
      })),
      // Only when the feed answered: an outage must not make every account look removed.
      ...(feedError ? [] : tracked.filter((t) => !listed.has(t.login)).map((t) => ({ login: t.login, name: t.login, broker: '', balance: null, problem: 'not in the monitoring feed', updatedAt: null, inFeed: false, ...view(t.login) }))),
    ]
    return { accounts, feedError, feedConfigured }
  })

  fastify.post(
    '/accounts',
    {
      schema: {
        body: { type: 'object', required: ['login', 'currency'], additionalProperties: false, properties: { login: { type: 'string', minLength: 1, maxLength: 20 }, currency: currencySchema } },
      },
      config: { rateLimit: { max: 20, timeWindow: '1 minute' } },
    },
    async (request, reply) => {
      const body = request.body as { login: string; currency: Mt5Currency }
      const login = body.login.trim()
      if (!LOGIN.test(login)) return reply.status(400).send({ error: 'An MT5 login is a number' })

      // Only accounts the collector reports can be added, so a typo cannot create an account that never gets a value.
      let known
      try {
        known = (await feed.accounts()).some((a) => a.login === login)
      } catch (err) {
        if (err instanceof FeedNotConfiguredError) return reply.status(409).send({ error: 'Set the feed URL first' })
        request.log.warn({ err: reasonOf(err) }, 'MT5 feed unavailable')
        return reply.status(502).send({ error: `Could not read the monitoring feed: ${reasonOf(err)}` })
      }
      if (!known) return reply.status(400).send({ error: `Account ${login} is not in the monitoring feed` })

      const created = await createAccount(login, body.currency)
      if (!created) return reply.status(409).send({ error: `Account ${login} is already tracked` })
      return reply.status(201).send(created)
    }
  )

  fastify.patch(
    '/accounts/:login',
    {
      schema: {
        params: loginParams,
        body: { type: 'object', additionalProperties: false, minProperties: 1, properties: { currency: currencySchema, active: { type: 'boolean' } } },
      },
      config: { rateLimit: { max: 60, timeWindow: '1 minute' } },
    },
    async (request, reply) => {
      const { login } = request.params as { login: string }
      const body = request.body as { currency?: Mt5Currency; active?: boolean }
      if (!(await getAccount(login))) return reply.status(404).send({ error: 'Account not found' })
      const updated = await updateAccount(login, body)
      if (!updated) return reply.status(404).send({ error: 'Account not found' })
      return updated
    }
  )

  fastify.delete('/accounts/:login', { schema: { params: loginParams } }, async (request, reply) => {
    const { login } = request.params as { login: string }
    if (!(await deleteAccount(login))) return reply.status(404).send({ error: 'Account not found' })
    return reply.status(204).send()
  })
}
