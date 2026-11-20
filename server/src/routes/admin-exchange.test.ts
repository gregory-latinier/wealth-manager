import { FastifyInstance } from 'fastify'
import { buildApp } from '../index'
import { pool, query } from '../db/index'
import { SESSION_COOKIE } from '../lib/auth'
import { dec } from '../lib/money'
import { runSnapshot } from '../lib/snapshot'
import { ProviderError } from '../sources/crypto/providers/types'
import type { FxProvider } from '../sources/fx/frankfurter'
import { createExchangeSource } from '../sources/exchange'
import { createAccount } from '../sources/exchange/accounts'
import type { Credentials, ExchangeAdapter, ExchangeBalance } from '../sources/exchange/types'

const KEY = 'AbCdEf0123456789KEY'
const SECRET = 'c2VjcmV0LXZhbHVlLXRoYXQtbXVzdC1uZXZlci1sZWFr'

const fx: FxProvider = { getUsdPerEur: async () => ({ usdPerEur: dec('1.1'), date: '2026-11-20' }) }

/** A Kraken stand-in. `behaviour` decides what each call does, so a test can make it accept, reject, fail or hold balances. */
function fakeKraken() {
  const state: { verify: 'ok' | 'rejected' | 'down'; balances: ExchangeBalance[] | Error; seen: Credentials[] } = {
    verify: 'ok',
    balances: [],
    seen: [],
  }
  const adapter: ExchangeAdapter = {
    id: 'kraken',
    async verify(credentials) {
      state.seen.push(credentials)
      if (state.verify === 'rejected') throw new ProviderError('kraken', 'rpc', 'EAPI:Invalid key')
      if (state.verify === 'down') throw new ProviderError('kraken', 'timeout', 'no answer within 15000 ms')
    },
    async getBalances(credentials) {
      state.seen.push(credentials)
      if (state.balances instanceof Error) throw state.balances
      return state.balances
    },
  }
  return { state, adapter }
}

const line = (symbol: string, amount: string, priceUsd: string | null): ExchangeBalance => ({
  ref: symbol,
  symbol,
  amount: dec(amount),
  priceUsd: priceUsd === null ? null : dec(priceUsd),
})

describe('admin exchange accounts', () => {
  let app: FastifyInstance
  let cookies: Record<string, string>
  const kraken = fakeKraken()

  // Saving a key is limited to 10 a minute per client address, so each test comes from its own address.
  let client = 0
  let remoteAddress = ''

  beforeAll(async () => {
    app = await buildApp({ adminExchange: { adapters: { kraken: kraken.adapter } } })
    await app.ready()
    await query('DELETE FROM "Session"')
    const login = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { password: 'correct-horse-battery' } })
    cookies = { [SESSION_COOKIE]: login.cookies.find((c) => c.name === SESSION_COOKIE)!.value }
  })

  beforeEach(async () => {
    remoteAddress = `10.20.0.${++client}`
    kraken.state.verify = 'ok'
    kraken.state.balances = []
    kraken.state.seen = []
    await query('DELETE FROM "ExchangeAccount"')
    await query('DELETE FROM "SnapshotLine"')
    await query('DELETE FROM "Snapshot"')
  })

  afterAll(async () => {
    await app.close()
  })

  const add = (payload: unknown, authed = true) =>
    app.inject({ method: 'POST', url: '/api/admin/exchanges/accounts', payload: payload as object, cookies: authed ? cookies : {}, remoteAddress })
  const valid = (label = 'Main') => ({ exchange: 'kraken', label, credentials: { apiKey: KEY, apiSecret: SECRET } })

  it('requires a session on every route', async () => {
    const created = (await add(valid())).json()
    const calls = [
      { method: 'GET', url: '/api/admin/exchanges/accounts' },
      { method: 'POST', url: '/api/admin/exchanges/accounts', payload: valid('Other') },
      { method: 'PATCH', url: `/api/admin/exchanges/accounts/${created.id}`, payload: { active: false } },
      { method: 'DELETE', url: `/api/admin/exchanges/accounts/${created.id}` },
    ] as const
    for (const call of calls) {
      const res = await app.inject({ ...call })
      expect([call.method, res.statusCode]).toEqual([call.method, 401])
    }
    expect((await query('SELECT 1 FROM "ExchangeAccount"')).rowCount).toBe(1) // nothing changed
  })

  it('stores the key encrypted and never sends it back', async () => {
    const res = await add(valid('  Main  '))
    expect(res.statusCode).toBe(201)
    expect(res.json()).toMatchObject({ exchange: 'kraken', label: 'Main', active: true })

    const raw = (await query<{ credentials: string }>('SELECT "credentials" FROM "ExchangeAccount"')).rows[0].credentials
    expect(raw).not.toContain(KEY)
    expect(raw).not.toContain(SECRET)
    expect(raw.startsWith('v1.')).toBe(true)

    const list = await app.inject({ method: 'GET', url: '/api/admin/exchanges/accounts', cookies })
    expect(list.statusCode).toBe(200)
    expect(list.body).not.toContain(KEY)
    expect(list.body).not.toContain(SECRET)
    expect(list.body).not.toContain('credentials')
    expect(list.json()).toMatchObject({ ready: true, exchanges: [{ id: 'kraken', label: 'Kraken' }] })
    expect(res.body).not.toContain(SECRET)
  })

  it('trims pasted whitespace and checks the key with the exchange before saving', async () => {
    const res = await add({ exchange: 'kraken', label: 'Main', credentials: { apiKey: `  ${KEY}\n`, apiSecret: ` ${SECRET} ` } })
    expect(res.statusCode).toBe(201)
    expect(kraken.state.seen).toEqual([{ apiKey: KEY, apiSecret: SECRET }])
  })

  it('does not save a key the exchange rejects, and says why', async () => {
    kraken.state.verify = 'rejected'
    const res = await add(valid())
    expect(res.statusCode).toBe(400)
    expect(res.json().error).toContain('did not accept this key')
    expect(res.json().error).toContain('EAPI:Invalid key')
    expect(res.body).not.toContain(SECRET)
    expect((await query('SELECT 1 FROM "ExchangeAccount"')).rowCount).toBe(0)
  })

  it('does not save when the exchange cannot be reached, and tells that apart from a bad key', async () => {
    kraken.state.verify = 'down'
    const res = await add(valid())
    expect(res.statusCode).toBe(502)
    expect(res.json().error).toContain('Could not reach Kraken')
    expect((await query('SELECT 1 FROM "ExchangeAccount"')).rowCount).toBe(0)
  })

  it('rejects an unknown exchange, an empty name, odd characters and extra fields', async () => {
    expect((await add({ ...valid(), exchange: 'okx' })).statusCode).toBe(400) // not wired in this app instance
    expect((await add({ ...valid(), exchange: 'nope' })).statusCode).toBe(400)
    expect((await add({ ...valid(), label: '   ' })).statusCode).toBe(400)
    expect((await add({ ...valid(), credentials: { apiKey: 'has space', apiSecret: SECRET } })).statusCode).toBe(400)
    expect((await add({ ...valid(), credentials: { apiKey: KEY, apiSecret: SECRET, extra: 1 } })).statusCode).toBe(400)
    expect((await add({ ...valid(), extra: true })).statusCode).toBe(400)
    expect((await add({ exchange: 'kraken', label: 'x' })).statusCode).toBe(400)
    expect(kraken.state.seen).toHaveLength(0) // nothing malformed ever reached the exchange
  })

  it('keeps one name per exchange', async () => {
    expect((await add(valid('Main'))).statusCode).toBe(201)
    const dup = await add(valid('Main'))
    expect(dup.statusCode).toBe(409)
    expect((await add(valid('Second'))).statusCode).toBe(201)
  })

  it('renames, pauses and replaces the key (checked first), and never returns the key', async () => {
    const { id } = (await add(valid())).json()
    const patch = (payload: object) => app.inject({ method: 'PATCH', url: `/api/admin/exchanges/accounts/${id}`, payload, cookies, remoteAddress })

    expect((await patch({ label: 'Renamed', active: false })).json()).toMatchObject({ label: 'Renamed', active: false })

    const before = (await query<{ credentials: string }>('SELECT "credentials" FROM "ExchangeAccount"')).rows[0].credentials
    kraken.state.verify = 'rejected'
    expect((await patch({ credentials: { apiKey: 'NEWKEY123', apiSecret: 'NEWSECRET123' } })).statusCode).toBe(400)
    expect((await query<{ credentials: string }>('SELECT "credentials" FROM "ExchangeAccount"')).rows[0].credentials).toBe(before)

    kraken.state.verify = 'ok'
    const ok = await patch({ credentials: { apiKey: 'NEWKEY123', apiSecret: 'NEWSECRET123' } })
    expect(ok.statusCode).toBe(200)
    expect(ok.body).not.toContain('NEWSECRET123')
    expect((await query<{ credentials: string }>('SELECT "credentials" FROM "ExchangeAccount"')).rows[0].credentials).not.toBe(before)

    expect((await patch({ label: '   ' })).statusCode).toBe(400)
    expect((await app.inject({ method: 'PATCH', url: '/api/admin/exchanges/accounts/missing', payload: { active: true }, cookies })).statusCode).toBe(404)
  })

  it('refuses a rename onto another account name', async () => {
    await add(valid('A'))
    const { id } = (await add(valid('B'))).json()
    const res = await app.inject({ method: 'PATCH', url: `/api/admin/exchanges/accounts/${id}`, payload: { label: 'A' }, cookies })
    expect(res.statusCode).toBe(409)
  })

  it('deletes an account, leaving snapshot history untouched', async () => {
    const { id } = (await add(valid())).json()
    kraken.state.balances = [line('BTC', '1', '60000')]
    await runSnapshot({ sources: [createExchangeSource({ kraken: kraken.adapter })], fx, now: new Date('2026-11-20T10:00:00Z') })
    expect((await app.inject({ method: 'DELETE', url: `/api/admin/exchanges/accounts/${id}`, cookies })).statusCode).toBe(204)
    expect((await app.inject({ method: 'DELETE', url: `/api/admin/exchanges/accounts/${id}`, cookies })).statusCode).toBe(404)
    expect((await query('SELECT 1 FROM "SnapshotLine" WHERE "sourceType" = $1', ['exchange'])).rowCount).toBe(1)
  })

  it('reports the latest value of each account on the list', async () => {
    const { id } = (await add(valid())).json()
    kraken.state.balances = [line('BTC', '0.5', '60000'), line('USD', '100', '1')]
    await runSnapshot({ sources: [createExchangeSource({ kraken: kraken.adapter })], fx, now: new Date('2026-11-20T10:00:00Z') })
    const list = (await app.inject({ method: 'GET', url: '/api/admin/exchanges/accounts', cookies })).json()
    expect(list.accounts.find((a: { id: string }) => a.id === id).lastValue).toMatchObject({ usd: '30100.00000000', stale: false, date: '2026-11-20' })
  })
})

describe('exchange snapshot source', () => {
  const kraken = fakeKraken()
  const source = () => createExchangeSource({ kraken: kraken.adapter })
  let accountId: string

  beforeAll(async () => {
    // The routes are not needed here, so accounts are created through the storage layer directly.
    await query('DELETE FROM "ExchangeAccount"')
    accountId = (await createAccount({ exchange: 'kraken', label: 'Source test', credentials: { apiKey: KEY, apiSecret: SECRET } }))!.id
  })

  beforeEach(async () => {
    kraken.state.balances = []
    kraken.state.seen = []
    await query('DELETE FROM "SnapshotLine"')
    await query('DELETE FROM "Snapshot"')
    await query('UPDATE "ExchangeAccount" SET "active" = TRUE')
  })

  afterAll(async () => {
    await query('DELETE FROM "ExchangeAccount"')
  })

  /** Exchange lines of the latest snapshot only, so an earlier day's rows never mix in. */
  const lines = async () =>
    (await query<{ sourceRef: string; valueUsd: string; stale: boolean }>(
      `SELECT l."sourceRef", l."valueUsd"::text AS "valueUsd", l."stale"
         FROM "SnapshotLine" l
        WHERE l."sourceType" = 'exchange'
          AND l."snapshotId" = (SELECT "id" FROM "Snapshot" ORDER BY "date" DESC LIMIT 1)
        ORDER BY l."sourceRef"`
    )).rows

  it('values every balance and decrypts the key it passes to the exchange', async () => {
    kraken.state.balances = [line('BTC', '0.5', '60000'), line('USD', '100', '1')]
    const summary = await runSnapshot({ sources: [source()], fx, now: new Date('2026-11-20T10:00:00Z') })
    expect(summary.status).toBe('complete')
    expect(await lines()).toEqual([
      { sourceRef: `kraken:${accountId}:BTC`, valueUsd: '30000.00000000', stale: false },
      { sourceRef: `kraken:${accountId}:USD`, valueUsd: '100.00000000', stale: false },
    ])
    expect(kraken.state.seen).toEqual([{ apiKey: KEY, apiSecret: SECRET }])
  })

  it('carries the last values forward when the whole account cannot be read, instead of dropping it', async () => {
    kraken.state.balances = [line('BTC', '0.5', '60000')]
    await runSnapshot({ sources: [source()], fx, now: new Date('2026-11-20T10:00:00Z') })

    kraken.state.balances = new ProviderError('kraken', 'timeout', 'no answer within 15000 ms')
    const summary = await runSnapshot({ sources: [source()], fx, now: new Date('2026-11-21T10:00:00Z') })
    expect(summary.status).toBe('partial')
    // staleSince is the date of the last good value, not the day the lookup failed.
    expect(summary.stale).toEqual([{ sourceType: 'exchange', sourceRef: `kraken:${accountId}:BTC`, staleSince: '2026-11-20' }])
    expect(await lines()).toEqual([{ sourceRef: `kraken:${accountId}:BTC`, valueUsd: '30000.00000000', stale: true }])
  })

  it('carries an unpriced asset forward instead of valuing it at 0', async () => {
    kraken.state.balances = [line('BTC', '1', '60000'), line('FOO', '5', '2')]
    await runSnapshot({ sources: [source()], fx, now: new Date('2026-11-20T10:00:00Z') })

    kraken.state.balances = [line('BTC', '1', '60000'), line('FOO', '5', null)]
    const summary = await runSnapshot({ sources: [source()], fx, now: new Date('2026-11-21T10:00:00Z') })
    expect(summary.stale.map((s) => s.sourceRef)).toEqual([`kraken:${accountId}:FOO`])
    expect((await lines()).find((l) => l.sourceRef.endsWith(':FOO'))).toMatchObject({ valueUsd: '10.00000000', stale: true })
  })

  it('marks a new account that fails on its first run as left out, with the reason', async () => {
    kraken.state.balances = new ProviderError('kraken', 'rpc', 'EAPI:Invalid key')
    const summary = await runSnapshot({ sources: [source()], fx, now: new Date('2026-11-20T10:00:00Z') })
    expect(summary.status).toBe('partial')
    expect(summary.leftOut).toEqual([{ sourceType: 'exchange', sourceRef: `kraken:${accountId}:*`, reason: 'kraken: EAPI:Invalid key' }])
  })

  it('skips a paused account and does not call its exchange', async () => {
    await query('UPDATE "ExchangeAccount" SET "active" = FALSE')
    kraken.state.balances = [line('BTC', '1', '60000')]
    await runSnapshot({ sources: [source()], fx, now: new Date('2026-11-20T10:00:00Z') })
    expect(await lines()).toEqual([])
    expect(kraken.state.seen).toHaveLength(0)
  })

  it('fails one account alone when its key cannot be decrypted', async () => {
    const second = (await createAccount({ exchange: 'kraken', label: 'Second', credentials: { apiKey: 'OTHERKEY', apiSecret: 'OTHERSECRET' } }))!
    await query(`UPDATE "ExchangeAccount" SET "credentials" = 'v1.AAAA.AAAA.AAAA' WHERE "id" = $1`, [second.id])
    kraken.state.balances = [line('BTC', '1', '60000')]
    const summary = await runSnapshot({ sources: [source()], fx, now: new Date('2026-11-20T10:00:00Z') })
    expect((await lines()).map((l) => l.sourceRef)).toEqual([`kraken:${accountId}:BTC`])
    expect(summary.leftOut.map((l) => l.sourceRef)).toEqual([`kraken:${second.id}:*`])
    expect(summary.leftOut[0].reason).toContain('could not be decrypted')
    await query('DELETE FROM "ExchangeAccount" WHERE "id" = $1', [second.id])
  })

  it('reports an account whose exchange is not supported instead of crashing', async () => {
    await query(`UPDATE "ExchangeAccount" SET "exchange" = 'okx' WHERE "id" = $1`, [accountId])
    const summary = await runSnapshot({ sources: [source()], fx, now: new Date('2026-11-20T10:00:00Z') })
    expect(summary.leftOut[0].reason).toContain('okx is not supported')
    await query(`UPDATE "ExchangeAccount" SET "exchange" = 'kraken' WHERE "id" = $1`, [accountId])
  })
})

// One pool for the whole file: both suites above share it.
afterAll(async () => {
  await pool.end()
})
