import { FastifyInstance } from 'fastify'
import { buildApp } from '../index'
import { pool, query } from '../db/index'
import { SESSION_COOKIE } from '../lib/auth'
import { dec } from '../lib/money'
import { ProviderError } from '../sources/crypto/providers/types'
import { activeAccounts } from '../sources/mt5/accounts'
import { deleteSetting } from '../lib/settings'
import { FeedNotConfiguredError, type FeedAccount, type Mt5Feed } from '../sources/mt5/feed'

const fed = (login: string, over: Partial<FeedAccount> = {}): FeedAccount => ({
  login,
  name: `Account ${login}`,
  broker: 'RoboForex',
  balance: dec('100.5'),
  problem: null,
  updatedAt: new Date('2026-11-23T15:00:00Z'),
  ...over,
})

describe('admin mt5', () => {
  let app: FastifyInstance
  let cookies: Record<string, string>
  let client = 0
  let remoteAddress = ''
  let feedAccounts: FeedAccount[] = []
  let feedDown = false
  let feedUnset = false

  const feed: Mt5Feed = {
    accounts: async () => {
      if (feedUnset) throw new FeedNotConfiguredError()
      if (feedDown) throw new ProviderError('mt5-feed', 'network', 'connection refused')
      return feedAccounts
    },
  }

  beforeAll(async () => {
    app = await buildApp({ adminMt5: { feed } })
    await app.ready()
    await query('DELETE FROM "Session"')
    const login = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { password: 'correct-horse-battery' } })
    cookies = { [SESSION_COOKIE]: login.cookies.find((c) => c.name === SESSION_COOKIE)!.value }
  })

  beforeEach(async () => {
    remoteAddress = `10.44.0.${++client}`
    feedAccounts = [fed('111'), fed('222', { balance: null, problem: 'error: terminal not connected' })]
    feedDown = false
    feedUnset = false
    await deleteSetting('mt5.feedUrl')
    delete process.env.MT5_FEED_URL
    await query('DELETE FROM "Mt5Account"')
    await query('DELETE FROM "SnapshotLine"')
    await query('DELETE FROM "Snapshot"')
  })

  afterAll(async () => {
    await app.close()
    await pool.end()
  })

  const add = (payload: unknown) => app.inject({ method: 'POST', url: '/api/admin/mt5/accounts', payload: payload as object, cookies, remoteAddress })
  const patch = (login: string, payload: object) => app.inject({ method: 'PATCH', url: `/api/admin/mt5/accounts/${login}`, payload, cookies, remoteAddress })
  const list = async () => (await app.inject({ method: 'GET', url: '/api/admin/mt5/accounts', cookies, remoteAddress })).json()

  it('requires a session on every route', async () => {
    await add({ login: '111', currency: 'USD' })
    const calls = [
      { method: 'GET', url: '/api/admin/mt5/accounts' },
      { method: 'GET', url: '/api/admin/mt5/settings' },
      { method: 'PUT', url: '/api/admin/mt5/settings', payload: { feedUrl: 'https://example.com/x' } },
      { method: 'POST', url: '/api/admin/mt5/accounts', payload: { login: '111', currency: 'USD' } },
      { method: 'PATCH', url: '/api/admin/mt5/accounts/111', payload: { active: false } },
      { method: 'DELETE', url: '/api/admin/mt5/accounts/111' },
    ] as const
    for (const call of calls) {
      const res = await app.inject({ ...call })
      expect([call.method, call.url, res.statusCode]).toEqual([call.method, call.url, 401])
    }
    expect((await query('SELECT 1 FROM "Mt5Account"')).rowCount).toBe(1)
  })

  const putSettings = (payload: unknown) => app.inject({ method: 'PUT', url: '/api/admin/mt5/settings', payload: payload as object, cookies, remoteAddress })

  it('stores the feed URL, normalised, and reads it back', async () => {
    expect((await putSettings({ feedUrl: ' https://example.com/accounts-monitoring/api/snapshot ' })).json()).toEqual({
      feedUrl: 'https://example.com/accounts-monitoring/api/snapshot',
      feedUrlSource: 'setting',
    })
    const res = await app.inject({ method: 'GET', url: '/api/admin/mt5/settings', cookies, remoteAddress })
    expect(res.json()).toMatchObject({ feedUrl: 'https://example.com/accounts-monitoring/api/snapshot', feedUrlSource: 'setting' })
  })

  it('refuses a feed URL that is not a plain http or https address', async () => {
    for (const feedUrl of ['not a url', 'ftp://example.com/x', 'javascript:alert(1)', 'https://user:secret@example.com/x']) {
      expect([feedUrl, (await putSettings({ feedUrl })).statusCode]).toEqual([feedUrl, 400])
    }
    expect((await putSettings({})).statusCode).toBe(400)
    expect((await putSettings({ feedUrl: 'https://example.com/x', other: 1 })).statusCode).toBe(400)
  })

  it('forgets the stored URL when it is emptied, and falls back to the environment', async () => {
    await putSettings({ feedUrl: 'https://example.com/a' })
    process.env.MT5_FEED_URL = 'https://env.example.com/b'
    expect((await putSettings({ feedUrl: '' })).json()).toEqual({ feedUrl: 'https://env.example.com/b', feedUrlSource: 'environment' })
  })

  it('has no feed URL until one is set', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/admin/mt5/settings', cookies, remoteAddress })
    expect(res.json()).toEqual({ feedUrl: null, feedUrlSource: null })
  })

  it('says the feed is not configured, without calling it an outage, and refuses to add an account', async () => {
    feedUnset = true
    const res = await app.inject({ method: 'GET', url: '/api/admin/mt5/accounts', cookies, remoteAddress })
    expect(res.json()).toMatchObject({ accounts: [], feedConfigured: false })
    expect((await add({ login: '111', currency: 'USD' })).statusCode).toBe(409)
  })

  it('lists the accounts of the feed, tracked or not, with their problem', async () => {
    await add({ login: '111', currency: 'EUR' })
    const { accounts, feedError } = await list()
    expect(feedError).toBeNull()
    expect(accounts).toHaveLength(2)
    expect(accounts[0]).toMatchObject({ login: '111', name: 'Account 111', balance: '100.5', problem: null, inFeed: true, tracked: { currency: 'EUR', active: true, lastValue: null } })
    expect(accounts[1]).toMatchObject({ login: '222', balance: null, problem: 'error: terminal not connected', tracked: null })
  })

  it('still lists the tracked accounts when the feed is down, and says why', async () => {
    await add({ login: '111', currency: 'USD' })
    feedDown = true
    const res = await app.inject({ method: 'GET', url: '/api/admin/mt5/accounts', cookies, remoteAddress })
    expect(res.statusCode).toBe(200)
    expect(res.json().feedError).toContain('connection refused')
    expect(res.json().accounts).toEqual([])
  })

  it('keeps a tracked account the feed no longer lists, so it can be removed', async () => {
    await add({ login: '111', currency: 'USD' })
    feedAccounts = []
    const { accounts } = await list()
    expect(accounts).toEqual([expect.objectContaining({ login: '111', inFeed: false, problem: 'not in the monitoring feed', tracked: expect.objectContaining({ currency: 'USD' }) })])
  })

  it('adds an account of the feed with the chosen currency', async () => {
    const res = await add({ login: ' 111 ', currency: 'EUR' })
    expect(res.statusCode).toBe(201)
    expect(res.json()).toMatchObject({ login: '111', currency: 'EUR', active: true })
    expect((await activeAccounts()).map((a) => a.login)).toEqual(['111'])
  })

  it('adds an account whose collector row is in error, so it is counted once it recovers', async () => {
    expect((await add({ login: '222', currency: 'USD' })).statusCode).toBe(201)
  })

  it('refuses a login that is not in the feed', async () => {
    const res = await add({ login: '999', currency: 'USD' })
    expect(res.statusCode).toBe(400)
    expect(res.json().error).toContain('not in the monitoring feed')
    expect((await query('SELECT 1 FROM "Mt5Account"')).rowCount).toBe(0)
  })

  it('refuses a login that is not a number, a missing or unknown currency, and extra fields', async () => {
    expect((await add({ login: 'abc', currency: 'USD' })).statusCode).toBe(400)
    expect((await add({ login: '111' })).statusCode).toBe(400)
    expect((await add({ login: '111', currency: 'GBP' })).statusCode).toBe(400)
    expect((await add({ login: '111', currency: 'USD', name: 'x' })).statusCode).toBe(400)
  })

  it('answers 502 when the feed cannot be read while adding', async () => {
    feedDown = true
    expect((await add({ login: '111', currency: 'USD' })).statusCode).toBe(502)
  })

  it('refuses a second add of the same login', async () => {
    await add({ login: '111', currency: 'USD' })
    expect((await add({ login: '111', currency: 'EUR' })).statusCode).toBe(409)
    expect((await activeAccounts())[0]!.currency).toBe('USD')
  })

  it('changes the currency and pauses an account', async () => {
    await add({ login: '111', currency: 'USD' })
    expect((await patch('111', { currency: 'EUR' })).json()).toMatchObject({ currency: 'EUR', active: true })
    expect((await patch('111', { active: false })).json()).toMatchObject({ currency: 'EUR', active: false })
    expect(await activeAccounts()).toEqual([])
  })

  it('refuses an empty or unknown patch and answers 404 for an unknown account', async () => {
    await add({ login: '111', currency: 'USD' })
    expect((await patch('111', {})).statusCode).toBe(400)
    expect((await patch('111', { login: '5' })).statusCode).toBe(400)
    expect((await patch('111', { currency: 'GBP' })).statusCode).toBe(400)
    expect((await patch('999', { active: false })).statusCode).toBe(404)
  })

  it('removes an account and leaves the snapshot history alone', async () => {
    await add({ login: '111', currency: 'USD' })
    await query(`INSERT INTO "Snapshot" ("id", "date", "totalUsd", "totalEur", "usdPerEur", "status") VALUES ('s1', '2026-11-22', 100, 90, 1.25, 'complete')`)
    await query(
      `INSERT INTO "SnapshotLine" ("id", "snapshotId", "sourceType", "sourceRef", "symbol", "amount", "priceUsd", "valueUsd", "valueEur", "stale")
       VALUES ('l1', 's1', 'mt5', '111:USD', 'USD', 100, 1, 100, 90, false)`
    )
    expect((await app.inject({ method: 'DELETE', url: '/api/admin/mt5/accounts/111', cookies, remoteAddress })).statusCode).toBe(204)
    expect((await app.inject({ method: 'DELETE', url: '/api/admin/mt5/accounts/111', cookies, remoteAddress })).statusCode).toBe(404)
    expect((await query('SELECT 1 FROM "SnapshotLine" WHERE "sourceType" = \'mt5\'')).rowCount).toBe(1)
  })

  it('shows the value of the latest snapshot next to the account', async () => {
    await add({ login: '111', currency: 'USD' })
    await query(`INSERT INTO "Snapshot" ("id", "date", "totalUsd", "totalEur", "usdPerEur", "status") VALUES ('s1', '2026-11-22', 100, 90, 1.25, 'complete')`)
    await query(
      `INSERT INTO "SnapshotLine" ("id", "snapshotId", "sourceType", "sourceRef", "symbol", "amount", "priceUsd", "valueUsd", "valueEur", "stale")
       VALUES ('l1', 's1', 'mt5', '111:USD', 'USD', 100.5, 1, 100.5, 90.45, true)`
    )
    const { accounts } = await list()
    expect(accounts[0].tracked.lastValue).toMatchObject({ date: '2026-11-22', stale: true })
    expect(Number(accounts[0].tracked.lastValue.usd)).toBe(100.5)
  })
})
